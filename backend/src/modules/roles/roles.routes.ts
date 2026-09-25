/**
 * @file roles.routes.ts
 * @description Routes for role retrieval and assignment.
 */

import { Router } from 'express';
import { RolesController } from './roles.controller';
import { requireAuth } from '@/middleware/auth';
import { z } from 'zod';
import { validate } from '@/modules/auth/auth.schema';

const addRoleSchema = z.object({
  body: z.object({
    role: z.enum(['LEARNER', 'TUTOR']),
  }),
});

const router = Router();
const controller = new RolesController();

router.use(requireAuth);

router.get('/me', controller.getMyRoles.bind(controller));
router.post('/me', validate(addRoleSchema), controller.addRole.bind(controller));
router.delete('/me/:role', controller.removeRole.bind(controller));

export default router;
