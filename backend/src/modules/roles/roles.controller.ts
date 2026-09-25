/**
 * @file roles.controller.ts
 * @description Controllers for querying and updating user roles.
 */

import { Request, Response, NextFunction } from 'express';
import { RolesService } from './roles.service';

const rolesService = new RolesService();

export class RolesController {
  /**
   * GET /api/v1/roles/me
   */
  async getMyRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roles = await rolesService.getUserRoles(req.user!.id);
      res.status(200).json({
        success: true,
        data: { roles },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/roles/me
   */
  async addRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role } = req.body;
      const roles = await rolesService.addRole(req.user!.id, role, req.user!.id, req);
      res.status(200).json({
        success: true,
        message: `Role '${role}' added successfully`,
        data: { roles },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/roles/me/:role
   */
  async removeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role } = req.params as { role: 'LEARNER' | 'TUTOR' };
      await rolesService.removeRole(req.user!.id, role, req.user!.id, req);
      res.status(200).json({
        success: true,
        message: `Role '${role}' removed successfully`,
      });
    } catch (err) {
      next(err);
    }
  }
}
