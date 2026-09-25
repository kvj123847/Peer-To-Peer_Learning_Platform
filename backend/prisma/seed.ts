/**
 * @file seed.ts
 * @description Database seeder with sample accounts across both School and College tiers,
 * verified mentor profiles, approved courses, and live sessions.
 */

import { PrismaClient, AgeTier, AccountStatus, UserRoleType, PublishStatus, SessionType, SessionStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Password hash for all demo users: 'Password123!'
  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);

  // ── 1. Create School Learner ────────────────────────────────────────────────
  const schoolLearner = await prisma.user.upsert({
    where: { email: 'school_learner@example.com' },
    update: {},
    create: {
      email: 'school_learner@example.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Sam',
      lastName: 'Student',
      ageTier: AgeTier.SCHOOL,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      roles: {
        create: [{ role: UserRoleType.LEARNER, isActive: true }],
      },
    },
  });

  // ── 2. Create School Tutor ──────────────────────────────────────────────────
  const schoolTutor = await prisma.user.upsert({
    where: { email: 'school_tutor@example.com' },
    update: {},
    create: {
      email: 'school_tutor@example.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Sarah',
      lastName: 'Senior',
      ageTier: AgeTier.SCHOOL,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      roles: {
        create: [
          { role: UserRoleType.LEARNER, isActive: true },
          { role: UserRoleType.TUTOR, isActive: true },
        ],
      },
      tutorProfile: {
        create: {
          bio: 'High school senior with straight As in GCSE/A-level Math and Physics.',
          subjects: ['Mathematics', 'Physics'],
          hourlyRate: 20.0,
          currency: 'USD',
          yearsExperience: 2,
          educationLevel: 'High School Senior',
          isVerifiedByMentor: true,
          availability: {
            monday: [{ start: '16:00', end: '19:00' }],
            wednesday: [{ start: '16:00', end: '19:00' }],
          },
        },
      },
    },
    include: { tutorProfile: true },
  });

  // ── 3. Create College Learner ───────────────────────────────────────────────
  const collegeLearner = await prisma.user.upsert({
    where: { email: 'college_learner@example.com' },
    update: {},
    create: {
      email: 'college_learner@example.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Chris',
      lastName: 'College',
      ageTier: AgeTier.COLLEGE,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      roles: {
        create: [{ role: UserRoleType.LEARNER, isActive: true }],
      },
    },
  });

  // ── 4. Create College Tutor ─────────────────────────────────────────────────
  const collegeTutor = await prisma.user.upsert({
    where: { email: 'college_tutor@example.com' },
    update: {},
    create: {
      email: 'college_tutor@example.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Taylor',
      lastName: 'Tech',
      ageTier: AgeTier.COLLEGE,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      roles: {
        create: [
          { role: UserRoleType.LEARNER, isActive: true },
          { role: UserRoleType.TUTOR, isActive: true },
        ],
      },
      tutorProfile: {
        create: {
          bio: 'Computer Science sophomore at Stanford tutoring Data Structures and Web Dev.',
          subjects: ['Computer Science', 'Algorithms', 'Web Development'],
          hourlyRate: 45.0,
          currency: 'USD',
          yearsExperience: 3,
          educationLevel: 'Undergraduate',
          university: 'Stanford University',
          isVerifiedByMentor: true,
          availability: {
            tuesday: [{ start: '18:00', end: '21:00' }],
            thursday: [{ start: '18:00', end: '21:00' }],
          },
        },
      },
    },
    include: { tutorProfile: true },
  });

  // ── 5. Create Degree-holding Mentor ─────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'mentor@example.com' },
    update: {},
    create: {
      email: 'mentor@example.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Dr. Michael',
      lastName: 'Mentor',
      ageTier: AgeTier.COLLEGE,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      roles: {
        create: [{ role: UserRoleType.MENTOR, isActive: true }],
      },
      mentorProfile: {
        create: {
          degreeName: 'M.Ed. Curriculum and Instruction',
          university: 'University of Cambridge',
          degreeVerificationUrl: 'https://storage.example.com/degrees/michael_cambridge.pdf',
          isVerified: true,
        },
      },
    },
  });

  // ── 6. Create Sample Courses in Each Tier ───────────────────────────────────
  if (schoolTutor.tutorProfile) {
    await prisma.course.create({
      data: {
        tutorId: schoolTutor.tutorProfile.id,
        title: 'Mastering High School Algebra',
        description: 'Complete algebraic foundations for school students.',
        subject: 'Mathematics',
        ageTierFilter: AgeTier.SCHOOL,
        price: 15.0,
        currency: 'USD',
        publishStatus: PublishStatus.PUBLISHED,
        lessonCount: 2,
        lessons: {
          create: [
            {
              title: 'Linear Equations and Graphing',
              content: 'Understanding slopes, intercepts, and linear solutions.',
              duration: 1200,
              sortOrder: 0,
            },
            {
              title: 'Quadratic Factorization',
              content: 'Factoring quadratics with zero-product property.',
              duration: 1500,
              sortOrder: 1,
            },
          ],
        },
      },
    });
  }

  if (collegeTutor.tutorProfile) {
    await prisma.course.create({
      data: {
        tutorId: collegeTutor.tutorProfile.id,
        title: 'Data Structures & Algorithms in TypeScript',
        description: 'Comprehensive college-level guide to graphs, trees, and dynamic programming.',
        subject: 'Computer Science',
        ageTierFilter: AgeTier.COLLEGE,
        price: 39.99,
        currency: 'USD',
        publishStatus: PublishStatus.PUBLISHED,
        lessonCount: 2,
        lessons: {
          create: [
            {
              title: 'Graph Traversal (BFS & DFS)',
              content: 'Algorithmic time complexity and traversal implementations.',
              duration: 2400,
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // Create a live session for college tutor
    await prisma.liveSession.create({
      data: {
        tutorId: collegeTutor.tutorProfile.id,
        title: 'Live LeetCode Hard Walkthrough',
        description: 'Interactive session solving hard dynamic programming problems.',
        sessionType: SessionType.GROUP,
        ageTierFilter: AgeTier.COLLEGE,
        subject: 'Computer Science',
        maxParticipants: 8,
        price: 25.0,
        currency: 'USD',
        scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        durationMinutes: 60,
        status: SessionStatus.SCHEDULED,
        videoRoomId: 'room_college_demo_session',
      },
    });
  }

  console.log('✅ Database successfully seeded!');
  console.log('Demo Credentials:');
  console.log(' - School Learner:  school_learner@example.com / Password123!');
  console.log(' - School Tutor:    school_tutor@example.com / Password123!');
  console.log(' - College Learner: college_learner@example.com / Password123!');
  console.log(' - College Tutor:   college_tutor@example.com / Password123!');
  console.log(' - Verified Mentor: mentor@example.com / Password123!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
