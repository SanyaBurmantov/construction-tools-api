# Dockerfile
FROM node:20-bullseye AS development

WORKDIR /backend

# Копируем файлы зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY . .

RUN npm install -g @nestjs/cli

# Генерируем Prisma клиент
COPY prisma ./prisma
RUN npx prisma generate
# Открываем порт для приложения
EXPOSE 8000

# Запускаем в режиме разработки
CMD ["npm", "run", "start:dev"]