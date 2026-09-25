/**
 * @file mentorReview.service.ts
 * @description Mentor review workflow service.
 * Implements strict review state machine:
 * Tutor submits -> PENDING_REVIEW -> Mentor queue -> APPROVED / REJECTED -> feedback stored -> Approved item becomes publishable.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { ApiError } from '@/middleware/errorHandler';
import { auditLog } from '@/utils/audit';
import { sendMentorReviewNotification } from '@/utils/email';
import { ContentType, ReviewStatus, PublishStatus } from '@prisma/client';

export interface ContentReviewDto {
  id: string;
  contentId: string;
  contentType: ContentType;
  mentorId: string | null;
  status: ReviewStatus;
  feedback: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface ReviewQueueItemDto extends ContentReviewDto {
  contentTitle?: string;
  contentDescription?: string;
  tutorName?: string;
  ageTier?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class MentorReviewService {
  /**
   * Tutor submits course or session for mentor review.
   */
  async submitForReview(
    userId: string,
    contentId: string,
    contentType: 'COURSE' | 'SESSION',
    req?: Request,
  ): Promise<ContentReviewDto> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
    });

    if (!tutor) {
      throw ApiError.forbidden('Only registered tutors can submit content for review');
    }

    if (contentType === 'COURSE') {
      const course = await prisma.course.findUnique({
        where: { id: contentId },
      });

      if (!course) {
        throw ApiError.notFound('Course not found');
      }

      if (course.tutorId !== tutor.id) {
        throw ApiError.forbidden('You do not own this course');
      }

      if (course.publishStatus === PublishStatus.PENDING_REVIEW) {
        throw ApiError.conflict('This course is already queued for review');
      }

      // Update course and create review atomically
      const review = await prisma.$transaction(async (tx) => {
        await tx.course.update({
          where: { id: contentId },
          data: { publishStatus: PublishStatus.PENDING_REVIEW },
        });

        return tx.contentReview.create({
          data: {
            contentId,
            contentType: ContentType.COURSE,
            status: ReviewStatus.PENDING_REVIEW,
          },
        });
      });

      await auditLog({
        actorId: userId,
        action: 'CONTENT_SUBMITTED_FOR_REVIEW',
        resource: 'Course',
        resourceId: contentId,
        metadata: { reviewId: review.id },
        success: true,
        req,
      });

      return review;
    } else {
      // LiveSession review
      const session = await prisma.liveSession.findUnique({
        where: { id: contentId },
      });

      if (!session) {
        throw ApiError.notFound('Session not found');
      }

      if (session.tutorId !== tutor.id) {
        throw ApiError.forbidden('You do not own this session');
      }

      const review = await prisma.contentReview.create({
        data: {
          contentId,
          contentType: ContentType.SESSION,
          status: ReviewStatus.PENDING_REVIEW,
        },
      });

      await auditLog({
        actorId: userId,
        action: 'SESSION_SUBMITTED_FOR_REVIEW',
        resource: 'LiveSession',
        resourceId: contentId,
        metadata: { reviewId: review.id },
        success: true,
        req,
      });

      return review;
    }
  }

  /**
   * Verified mentors retrieve the pending review queue.
   */
  async getReviewQueue(
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<ReviewQueueItemDto>> {
    const skip = (Math.max(1, page) - 1) * pageSize;

    const [reviews, total] = await Promise.all([
      prisma.contentReview.findMany({
        where: { status: ReviewStatus.PENDING_REVIEW },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'asc' },
        include: {
          course: {
            include: {
              tutor: {
                include: {
                  user: {
                    select: { firstName: true, lastName: true, ageTier: true },
                  },
                },
              },
            },
          },
          liveSession: {
            include: {
              tutor: {
                include: {
                  user: {
                    select: { firstName: true, lastName: true, ageTier: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.contentReview.count({
        where: { status: ReviewStatus.PENDING_REVIEW },
      }),
    ]);

    const data: ReviewQueueItemDto[] = reviews.map((r) => {
      let contentTitle: string | undefined;
      let contentDescription: string | undefined;
      let tutorName: string | undefined;
      let ageTier: string | undefined;

      if (r.contentType === ContentType.COURSE && r.course) {
        contentTitle = r.course.title;
        contentDescription = r.course.description;
        tutorName = `${r.course.tutor.user.firstName || ''} ${r.course.tutor.user.lastName || ''}`.trim();
        ageTier = r.course.tutor.user.ageTier;
      } else if (r.contentType === ContentType.SESSION && r.liveSession) {
        contentTitle = r.liveSession.title;
        contentDescription = r.liveSession.description;
        tutorName = `${r.liveSession.tutor.user.firstName || ''} ${r.liveSession.tutor.user.lastName || ''}`.trim();
        ageTier = r.liveSession.tutor.user.ageTier;
      }

      return {
        id: r.id,
        contentId: r.contentId,
        contentType: r.contentType,
        mentorId: r.mentorId,
        status: r.status,
        feedback: r.feedback,
        reviewedAt: r.reviewedAt,
        createdAt: r.createdAt,
        contentTitle,
        contentDescription,
        tutorName,
        ageTier,
      };
    });

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Approves a review item and marks the underlying content as APPROVED.
   */
  async approveReview(
    reviewId: string,
    mentorUserId: string,
    feedback?: string,
    req?: Request,
  ): Promise<ContentReviewDto> {
    const mentor = await prisma.mentorProfile.findUnique({
      where: { userId: mentorUserId },
    });

    if (!mentor || !mentor.isVerified) {
      throw ApiError.forbidden('Only verified mentors can approve submissions');
    }

    const review = await prisma.contentReview.findUnique({
      where: { id: reviewId },
      include: {
        course: { include: { tutor: { include: { user: true } } } },
        liveSession: { include: { tutor: { include: { user: true } } } },
      },
    });

    if (!review) {
      throw ApiError.notFound('Review item not found');
    }

    if (review.status !== ReviewStatus.PENDING_REVIEW) {
      throw ApiError.conflict('Review has already been processed');
    }

    const updatedReview = await prisma.$transaction(async (tx) => {
      const updated = await tx.contentReview.update({
        where: { id: reviewId },
        data: {
          mentorId: mentor.id,
          status: ReviewStatus.APPROVED,
          feedback: feedback ?? 'Content approved by mentor.',
          reviewedAt: new Date(),
        },
      });

      if (review.contentType === ContentType.COURSE) {
        await tx.course.update({
          where: { id: review.contentId },
          data: { publishStatus: PublishStatus.APPROVED },
        });
      }

      return updated;
    });

    // Notify tutor via email
    const tutorEmail =
      review.course?.tutor.user.email || review.liveSession?.tutor.user.email;
    if (tutorEmail) {
      sendMentorReviewNotification(tutorEmail, 'approved', feedback).catch(() => {});
    }

    await auditLog({
      actorId: mentorUserId,
      action: 'CONTENT_REVIEW_APPROVED',
      resource: 'ContentReview',
      resourceId: reviewId,
      metadata: { contentId: review.contentId, contentType: review.contentType },
      success: true,
      req,
    });

    return updatedReview;
  }

  /**
   * Rejects a review item with mandatory feedback.
   */
  async rejectReview(
    reviewId: string,
    mentorUserId: string,
    feedback: string,
    req?: Request,
  ): Promise<ContentReviewDto> {
    if (!feedback || feedback.trim().length < 10) {
      throw ApiError.badRequest('Rejection feedback of at least 10 characters is required');
    }

    const mentor = await prisma.mentorProfile.findUnique({
      where: { userId: mentorUserId },
    });

    if (!mentor || !mentor.isVerified) {
      throw ApiError.forbidden('Only verified mentors can review submissions');
    }

    const review = await prisma.contentReview.findUnique({
      where: { id: reviewId },
      include: {
        course: { include: { tutor: { include: { user: true } } } },
        liveSession: { include: { tutor: { include: { user: true } } } },
      },
    });

    if (!review) {
      throw ApiError.notFound('Review item not found');
    }

    if (review.status !== ReviewStatus.PENDING_REVIEW) {
      throw ApiError.conflict('Review has already been processed');
    }

    const updatedReview = await prisma.$transaction(async (tx) => {
      const updated = await tx.contentReview.update({
        where: { id: reviewId },
        data: {
          mentorId: mentor.id,
          status: ReviewStatus.REJECTED,
          feedback,
          reviewedAt: new Date(),
        },
      });

      if (review.contentType === ContentType.COURSE) {
        await tx.course.update({
          where: { id: review.contentId },
          data: { publishStatus: PublishStatus.REJECTED },
        });
      }

      return updated;
    });

    const tutorEmail =
      review.course?.tutor.user.email || review.liveSession?.tutor.user.email;
    if (tutorEmail) {
      sendMentorReviewNotification(tutorEmail, 'rejected', feedback).catch(() => {});
    }

    await auditLog({
      actorId: mentorUserId,
      action: 'CONTENT_REVIEW_REJECTED',
      resource: 'ContentReview',
      resourceId: reviewId,
      metadata: { contentId: review.contentId, contentType: review.contentType, feedback },
      success: true,
      req,
    });

    return updatedReview;
  }

  /**
   * Publishes approved content, making it visible to students of that age tier.
   */
  async publishContent(
    contentId: string,
    contentType: 'COURSE' | 'SESSION',
    userId: string,
    req?: Request,
  ): Promise<void> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
    });

    if (!tutor) {
      throw ApiError.forbidden('Only tutors can publish content');
    }

    if (contentType === 'COURSE') {
      const course = await prisma.course.findUnique({
        where: { id: contentId },
      });

      if (!course) {
        throw ApiError.notFound('Course not found');
      }

      if (course.tutorId !== tutor.id) {
        throw ApiError.forbidden('You do not own this course');
      }

      if (course.publishStatus !== PublishStatus.APPROVED) {
        throw ApiError.forbidden(
          `Cannot publish course: current status is ${course.publishStatus}. Must be APPROVED by a mentor.`,
        );
      }

      await prisma.course.update({
        where: { id: contentId },
        data: { publishStatus: PublishStatus.PUBLISHED },
      });

      await auditLog({
        actorId: userId,
        action: 'COURSE_PUBLISHED',
        resource: 'Course',
        resourceId: contentId,
        success: true,
        req,
      });
    }
  }

  /**
   * Returns review history/audit trail for a piece of content.
   */
  async getReviewHistory(contentId: string): Promise<ContentReviewDto[]> {
    return prisma.contentReview.findMany({
      where: { contentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Returns reviews for a tutor's content.
   */
  async getTutorReviews(userId: string): Promise<ContentReviewDto[]> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
    });

    if (!tutor) {
      throw ApiError.notFound('Tutor profile not found');
    }

    return prisma.contentReview.findMany({
      where: {
        OR: [
          { course: { tutorId: tutor.id } },
          { liveSession: { tutorId: tutor.id } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
