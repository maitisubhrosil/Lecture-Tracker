import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scheduleRouter from "./schedule";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scheduleRouter);
router.use(pushRouter);

export default router;
