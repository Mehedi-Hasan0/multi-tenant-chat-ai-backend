import express, { Request, Response, Application, NextFunction } from 'express';
import config from './config';
import cors, { CorsOptions } from 'cors';
import routes from './app/routes';
import httpStatus from 'http-status';
import globalErrorHandler from './app/middlewares/globalErrorHandler';

const app: Application = express();
const port = config.port;

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    callback(null, origin || '*');
  },
  credentials: true,
};

app.use(cors(corsOptions));

// parse body data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// routes
app.use('/api/v1', routes);

app.get('/', (req: Request, res: Response) => {
  res.send('Welcome to Multi tenant chat Server');
});

// global error handler
app.use(globalErrorHandler);

// not found routes
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(httpStatus.NOT_FOUND).json({
    success: false,
    message: 'Not found',
    errorMessage: [{ path: req.originalUrl, message: 'Api Not Found' }],
  });
  next();
});

app.listen(port, () => {
  console.log(`Server is Fire at http://localhost:${port}`);
});

export default app;
