import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import rolesRouter from "./roles";
import pagesRouter from "./pages";
import entitiesRouter from "./entities";
import translationsRouter from "./translations";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(pagesRouter);
router.use(entitiesRouter);
router.use(translationsRouter);
router.use(dashboardRouter);

export default router;
