/**
 * @file sessions.service.ts
 * @description Backend Session & Booking authorization service.
 * Contracts for Person 1 <-> Person 2 (Video Engine) <-> Person 3 (Mobile UI):
 * - Enforces age-tier separation at booking creation and room access validation.
 * - Prevents cross-tier participants from joining the same 1-on-1 or group session.
 * - Generates secure room access tokens for authorized participants only.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { ApiError } from '@/middleware/errorHandler';
import { assertAgeTierCompatible } from '@/utils/ageTierGuard';
import { auditLog } from '@/utils/audit';
import {
  AgeTier,
  BookingStatus,
  SessionStatus,
  SessionType,
  Prisma,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface CreateSessionDto {
  title: string;
  description: string;
  sessionType: SessionType;
  subject: string;
  maxParticipants?: number;
  price: number;
  currency?: string;
  scheduledAt: Date | string;
  durationMinutes: number;
}

export interface BookingResultDto {
  bookingId: string;
  sessionId: string;
  status: BookingStatus;
  scheduledAt: Date;
}

export interface RoomAccessCredentialsDto {
  sessionId: string;
  roomId: string;
  userId: string;
  role: 'HOST' | 'PARTICIPANT';
  userAgeTier: AgeTier;
  sessionAgeTier: AgeTier;
  authorizedAt: Date;
  sessionTitle: string;
}

export class SessionsService {
  /**
   * Tutor creates a live 1-on-1 or group session.
   * AgeTier is permanently locked to the tutor's authoritative ageTier.
   */
  async createSession(
    tutorUserId: string,
    data: CreateSessionDto,
    req?: Request,
  ) {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId: tutorUserId },
      include: { user: true },
    });

    if (!tutor) {
      throw ApiError.forbidden('Only registered tutors can create sessions');
    }

    const roomId = `room_${uuidv4()}`;

    const session = await prisma.liveSession.create({
      data: {
        tutorId: tutor.id,
        title: data.title,
        description: data.description,
        sessionType: data.sessionType,
        ageTierFilter: tutor.user.ageTier, // Authoritative lock to tutor's age tier
        subject: data.subject,
        maxParticipants: data.sessionType === SessionType.ONE_ON_ONE ? 1 : (data.maxParticipants ?? 10),
        price: new Prisma.Decimal(data.price),
        currency: data.currency ?? 'USD',
        scheduledAt: new Date(data.scheduledAt),
        durationMinutes: data.durationMinutes,
        status: SessionStatus.SCHEDULED,
        videoRoomId: roomId,
      },
    });

    await auditLog({
      actorId: tutorUserId,
      action: 'SESSION_CREATED',
      resource: 'LiveSession',
      resourceId: session.id,
      metadata: { ageTier: tutor.user.ageTier, type: data.sessionType },
      success: true,
      req,
    });

    return session;
  }

  /**
   * SAFETY-CRITICAL: Learner books a session.
   * Rejects cross-tier bookings at data level.
   */
  async bookSession(
    learnerUserId: string,
    sessionId: string,
    paymentId?: string,
    req?: Request,
  ): Promise<BookingResultDto> {
    const [learner, session] = await Promise.all([
      prisma.user.findUnique({ where: { id: learnerUserId } }),
      prisma.liveSession.findUnique({
        where: { id: sessionId },
        include: { bookings: { where: { status: BookingStatus.CONFIRMED } } },
      }),
    ]);

    if (!learner) throw ApiError.notFound('Learner not found');
    if (!session) throw ApiError.notFound('Session not found');

    if (session.status !== SessionStatus.SCHEDULED) {
      throw ApiError.badRequest('Session is not available for booking');
    }

    // SAFETY-CRITICAL CHECK: Learner age tier must match session age tier
    assertAgeTierCompatible(learner.ageTier, session.ageTierFilter, 'session booking');

    // Capacity check for group sessions
    if (session.maxParticipants && session.bookings.length >= session.maxParticipants) {
      throw ApiError.badRequest('Session has reached maximum participant capacity');
    }

    // Check for existing booking
    const existing = await prisma.sessionBooking.findFirst({
      where: {
        sessionId,
        learnerId: learnerUserId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
      },
    });

    if (existing) {
      throw ApiError.conflict('You already have a booking for this session');
    }

    const booking = await prisma.sessionBooking.create({
      data: {
        sessionId,
        learnerId: learnerUserId,
        status: BookingStatus.CONFIRMED,
        paymentId,
      },
    });

    await auditLog({
      actorId: learnerUserId,
      action: 'SESSION_BOOKED',
      resource: 'SessionBooking',
      resourceId: booking.id,
      metadata: { sessionId, ageTier: learner.ageTier },
      success: true,
      req,
    });

    return {
      bookingId: booking.id,
      sessionId: session.id,
      status: booking.status,
      scheduledAt: session.scheduledAt,
    };
  }

  /**
   * SAFETY-CRITICAL Contract for Person 2 (Video Lead):
   * Validates participant authorization and age-tier compliance before issuing
   * video room access tokens.
   */
  async authorizeRoomAccess(
    userId: string,
    sessionId: string,
    req?: Request,
  ): Promise<RoomAccessCredentialsDto> {
    const [user, session] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.liveSession.findUnique({
        where: { id: sessionId },
        include: { tutor: true },
      }),
    ]);

    if (!user) throw ApiError.unauthorized('User not found');
    if (!session) throw ApiError.notFound('Session not found');

    // NON-NEGOTIABLE AGE-TIER VERIFICATION
    assertAgeTierCompatible(user.ageTier, session.ageTierFilter, 'video room access');

    const isHost = session.tutor.userId === userId;

    if (!isHost) {
      // Must have confirmed booking
      const booking = await prisma.sessionBooking.findFirst({
        where: {
          sessionId,
          learnerId: userId,
          status: BookingStatus.CONFIRMED,
        },
      });

      if (!booking) {
        throw ApiError.forbidden('You do not have a confirmed booking for this session room');
      }
    }

    const roomId = session.videoRoomId ?? `room_${session.id}`;

    await auditLog({
      actorId: userId,
      action: 'VIDEO_ROOM_ACCESS_AUTHORIZED',
      resource: 'LiveSession',
      resourceId: sessionId,
      metadata: { role: isHost ? 'HOST' : 'PARTICIPANT', roomId },
      success: true,
      req,
    });

    return {
      sessionId: session.id,
      roomId,
      userId,
      role: isHost ? 'HOST' : 'PARTICIPANT',
      userAgeTier: user.ageTier,
      sessionAgeTier: session.ageTierFilter,
      authorizedAt: new Date(),
      sessionTitle: session.title,
    };
  }

  /**
   * Query sessions available for booking within the requesting user's age tier.
   */
  async listAvailableSessions(userAgeTier: AgeTier, page = 1, pageSize = 20) {
    const skip = (Math.max(1, page) - 1) * pageSize;

    const [sessions, total] = await Promise.all([
      prisma.liveSession.findMany({
        where: {
          ageTierFilter: userAgeTier, // HARD AGE-TIER FILTER
          status: SessionStatus.SCHEDULED,
          scheduledAt: { gte: new Date() },
        },
        skip,
        take: pageSize,
        orderBy: { scheduledAt: 'asc' },
        include: {
          tutor: {
            include: {
              user: {
                select: { firstName: true, lastName: true, avatarUrl: true },
              },
            },
          },
        },
      }),
      prisma.liveSession.count({
        where: {
          ageTierFilter: userAgeTier,
          status: SessionStatus.SCHEDULED,
          scheduledAt: { gte: new Date() },
        },
      }),
    ]);

    return {
      data: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        sessionType: s.sessionType,
        subject: s.subject,
        price: Number(s.price),
        currency: s.currency,
        scheduledAt: s.scheduledAt,
        durationMinutes: s.durationMinutes,
        maxParticipants: s.maxParticipants,
        tutorName: `${s.tutor.user.firstName || ''} ${s.tutor.user.lastName || ''}`.trim(),
        avatarUrl: s.tutor.user.avatarUrl,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
