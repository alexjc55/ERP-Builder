import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import rolesRouter from "./roles";
import pagesRouter from "./pages";
import entitiesRouter from "./entities";
import fieldsRouter from "./fields";
import statusesRouter from "./statuses";
import recordsRouter from "./records";
import relationsRouter from "./relations";
import viewsRouter from "./views";
import translationsRouter from "./translations";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(pagesRouter);
router.use(entitiesRouter);
router.use(fieldsRouter);
router.use(statusesRouter);
router.use(recordsRouter);
router.use(relationsRouter);
router.use(viewsRouter);
router.use(translationsRouter);
router.use(dashboardRouter);

export default router;
