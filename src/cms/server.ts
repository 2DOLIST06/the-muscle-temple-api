import 'dotenv/config';
import express from 'express';
import payload from 'payload';

const app = express();
const port = Number(process.env.CMS_PORT || 4001);

const start = async () => {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET || 'change-me-in-production',
    express: app,
    onInit: () => {
      payload.logger.info(`Payload CMS admin available at ${payload.getAdminURL()}`);
    }
  });

  app.listen(port, () => {
    payload.logger.info(`Payload CMS server running on port ${port}`);
  });
};

start();
