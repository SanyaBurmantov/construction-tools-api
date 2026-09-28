@echo off
echo 🚀 Запуск Construction Tools (Frontend + API + DB)...
echo.

REM Запуск всех сервисов
docker compose up --build -d

echo.
echo ✅ Сервисы запущены!
echo.
echo 📍 Порты:
echo    Frontend:  http://localhost:3000
echo    API:       http://localhost:3001
echo    Swagger:   http://localhost:3001/api
echo    Database:  localhost:5432
echo.
echo 📋 Логи:
echo    docker compose logs -f
echo.
echo 🛑 Остановка:
echo    docker compose down
pause
