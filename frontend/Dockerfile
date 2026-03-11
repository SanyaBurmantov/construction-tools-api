FROM node:20-bullseye

WORKDIR /frontend

# Копируем файлы package.json и package-lock.json (или yarn.lock)
COPY package*.json ./
COPY yarn.lock* ./
COPY pnpm-lock.yaml* ./

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY . .

# Открываем порт для dev сервера
EXPOSE 3000

# Запускаем dev режим
CMD ["npm", "run", "dev"]