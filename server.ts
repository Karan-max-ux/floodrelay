import express from 'express';
import vercelApp from './services/api/src/vercel.js';

const app = express();
app.use(vercelApp);

export default app;
