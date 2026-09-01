import express, { Request, Response, NextFunction } from 'express';
import { Store } from './store.js';
import { AuthContext } from './types.js';
import { RewardBankService, ServiceError } from './service.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function createAuthMiddleware(store: Store) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }
    const token = header.slice('Bearer '.length);
    const parent = store.getParentByToken(token);
    if (parent) {
      req.auth = { role: 'parent', parentId: parent.id };
      next();
      return;
    }
    const child = store.getChildByToken(token);
    if (child) {
      req.auth = { role: 'child', childId: child.id, parentId: child.parentId };
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid token' });
  };
}

export function requireParent(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'parent' || !req.auth.parentId) {
    res.status(403).json({ error: 'Parent token required' });
    return;
  }
  next();
}

export function requireChild(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'child' || !req.auth.childId) {
    res.status(403).json({ error: 'Child token required' });
    return;
  }
  next();
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof ServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

export function createRouter(service: RewardBankService, store: Store) {
  const router = express.Router();

  router.post('/setup', (_req: Request, res: Response) => {
    const parent = store.createParent('Demo Parent');
    const child = store.createChild(parent.id, 'Demo Child', 0);
    res.status(201).json({
      parent: { id: parent.id, name: parent.name, token: parent.token },
      child: { id: child.id, name: child.name, token: child.token },
    });
  });

  router.post('/tasks', requireParent, (req: Request, res: Response) => {
    try {
      const { childId, title, reward } = req.body;
      if (!childId || !title || reward == null) {
        res.status(400).json({ error: 'childId, title, and reward are required' });
        return;
      }
      const task = service.createTask(req.auth!.parentId!, childId, title, Number(reward));
      res.status(201).json(task);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/tasks/:taskId/done', requireChild, (req: Request, res: Response) => {
    try {
      const task = service.markTaskDone(req.auth!.childId!, req.params.taskId);
      res.json(task);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/tasks/:taskId/approve', requireParent, (req: Request, res: Response) => {
    try {
      const result = service.approveTask(req.auth!.parentId!, req.params.taskId);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/tasks/:taskId/reject', requireParent, (req: Request, res: Response) => {
    try {
      const task = service.rejectTask(req.auth!.parentId!, req.params.taskId);
      res.json(task);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/tasks/:taskId/undo-approval', requireParent, (req: Request, res: Response) => {
    try {
      const result = service.undoApproval(req.auth!.parentId!, req.params.taskId);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/usage/batch', requireChild, async (req: Request, res: Response) => {
    try {
      const sessions = req.body?.sessions;
      if (!Array.isArray(sessions)) {
        res.status(400).json({ error: 'sessions array is required' });
        return;
      }
      const results = await service.reportUsageBatch(req.auth!.childId!, sessions);
      res.json({ results });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/children/:childId/balance', (req: Request, res: Response) => {
    try {
      if (!canAccessChild(req, req.params.childId, store)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const balance = service.getBalance(req.params.childId);
      res.json({ childId: req.params.childId, balance });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/children/:childId/ledger', (req: Request, res: Response) => {
    try {
      if (!canAccessChild(req, req.params.childId, store)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const ledger = service.getLedger(req.params.childId);
      res.json({ childId: req.params.childId, ledger });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

function canAccessChild(req: Request, childId: string, store: Store): boolean {
  if (!req.auth) return false;
  if (req.auth.role === 'child') return req.auth.childId === childId;
  if (req.auth.role === 'parent') {
    const child = store.getChild(childId);
    return child?.parentId === req.auth.parentId;
  }
  return false;
}
