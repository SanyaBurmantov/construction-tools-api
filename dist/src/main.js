"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const prisma_service_1 = require("./prisma/prisma.service");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    const prismaService = app.get(prisma_service_1.PrismaService);
    try {
        await prismaService.$executeRawUnsafe('SELECT 1');
        console.log('Database connection successful');
    }
    catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
    const config = new swagger_1.DocumentBuilder()
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
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('api', app, document, {
        swaggerOptions: {
            persistAuthorization: true,
        },
    });
    await app.listen(3000);
    console.log(`Application is running on: http://localhost:3000`);
    console.log(`Swagger documentation: http://localhost:3000/api`);
}
bootstrap();
//# sourceMappingURL=main.js.map