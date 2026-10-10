import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// Safety net: a stray rejected promise from a background job (e.g. a parser
// cron) must not take the whole API process down. Errors are handled where they
// happen; this only guarantees uptime if one ever slips through, and logs it
// loudly so it is still visible.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const port = Number(process.env.PORT || 8000);
  const corsOrigin = process.env.CORS_ORIGIN;
  const bodyLimit = process.env.BODY_LIMIT ?? '1mb';

  // Behind the Caddy reverse proxy: trust the first hop so the throttler and
  // logs see the real client IP from X-Forwarded-For, not the proxy address.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  // Security headers. CSP is disabled here: this process is a JSON API behind
  // the Caddy/Nuxt edge, and the default CSP would break Swagger UI.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Explicit body parsers with a size limit (Nest's defaults are disabled above).
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((origin) => origin.trim())
      : true,
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const prismaService = app.get(PrismaService);
  try {
    await prismaService.$executeRawUnsafe('SELECT 1');
    console.log('Database connection successful');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }

  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.SWAGGER_ENABLED === 'true'
  ) {
    const config = new DocumentBuilder()
      .setTitle('Construction Tools API')
      .setVersion('1.0')
      // Both ways in: an account session for /auth and /admin, and the
      // x-admin-token service header for /admin.
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', name: 'x-admin-token', in: 'header' },
        'admin-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();
