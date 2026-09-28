import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend - разрешаем все origin для разработки
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Run migrations on startup
  const prismaService = app.get(PrismaService);
  try {
    await prismaService.$executeRawUnsafe('SELECT 1');
    console.log('Database connection successful');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Construction Tools API')
    .setDescription('API для парсинга и управления товарами строительных инструментов')
    .setVersion('1.0')
    .addTag('products', 'Товары')
    .addTag('categories', 'Категории')
    .addTag('facet-filters', 'Фасетные фильтры')
    .addTag('source-websites', 'Источники для парсинга')
    .addTag('parser', 'Парсинг')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
  console.log(`Swagger documentation: http://localhost:3000/api`);
}
bootstrap();
