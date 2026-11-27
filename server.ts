import express, { type Express } from 'express';
import app from './services/api/src/vercel.js';

// Vercel Express entrypoint
const serverlessApp: Express = app;
export default serverlessApp;

