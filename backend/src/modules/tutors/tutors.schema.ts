/**
 * @file tutors.schema.ts
 * @description Zod validation schemas for tutor profiles, onboarding, and availability.
 */

import { z } from 'zod';

export const timeSlotSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be HH:MM format'),
  end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be HH:MM format'),
});

export const availabilitySchema = z.record(
  z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  z.array(timeSlotSchema),
);

export const createTutorProfileSchema = z.object({
  body: z.object({
    bio: z.string().min(20, 'Bio must be at least 20 characters').max(2000),
    subjects: z.array(z.string().min(2)).min(1, 'Select at least 1 subject').max(10),
    hourlyRate: z.number().positive('Hourly rate must be greater than 0'),
    currency: z.string().default('USD'),
    yearsExperience: z.number().int().nonnegative().default(0),
    educationLevel: z.string().min(2),
    university: z.string().optional(),
    availability: availabilitySchema.optional().default({}),
  }),
});

export const updateTutorProfileSchema = z.object({
  body: z.object({
    bio: z.string().min(20).max(2000).optional(),
    subjects: z.array(z.string().min(2)).min(1).max(10).optional(),
    hourlyRate: z.number().positive().optional(),
    currency: z.string().optional(),
    yearsExperience: z.number().int().nonnegative().optional(),
    educationLevel: z.string().optional(),
    university: z.string().optional(),
    availability: availabilitySchema.optional(),
  }),
});
