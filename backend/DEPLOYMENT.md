# Production Deployment Guide

## 📋 Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- SSL certificates (for HTTPS)
- Domain name (optional)

## 🚀 Quick Start

### 1. Clone and Configure

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your production values
nano .env
```

### 2. SSL Certificates (Optional but Recommended)

```bash
# Using Let's Encrypt
mkdir -p nginx/ssl
certbot certonly --standalone -d your-domain.com

# Copy certificates
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/
cp /etc/letsencrypt/live/your-domain.com/chain.pem nginx/ssl/
```

### 3. Deploy

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

### 4. Run Migrations

```bash
# Run Prisma migrations
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# Generate Prisma Client
docker compose -f docker-compose.prod.yml exec app npx prisma generate
```

## 📊 Services

| Service | Port | Description |
|---------|------|-------------|
| **Nginx** | 80, 443 | Reverse proxy, SSL termination |
| **NestJS API** | 3000 | Main application |
| **PostgreSQL** | 5432 | Database (internal only) |

## 🔧 Management Commands

```bash
# Restart all services
docker compose -f docker-compose.prod.yml restart

# Restart specific service
docker compose -f docker-compose.prod.yml restart app

# View logs
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f db
docker compose -f docker-compose.prod.yml logs -f nginx

# Stop all services
docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (WARNING: deletes data)
docker compose -f docker-compose.prod.yml down -v

# Update and redeploy
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 🐍 Python Parsers

```bash
# Run parser inside container
docker compose -f docker-compose.prod.yml exec app python3 parsers/thtool_parser.py
docker compose -f docker-compose.prod.yml exec app python3 parsers/toolsby_parser.py

# Or run from host with PYTHONPATH
cd /path/to/project
PYTHONPATH=$PWD docker compose -f docker-compose.prod.yml exec -T app python3 parsers/thtool_parser.py
```

## 📝 Logs

- **API logs:** `logs/thtool_parser_*.log`, `logs/toolsby_parser_*.log`
- **Nginx logs:** `logs/nginx/access.log`, `logs/nginx/error.log`
- **Docker logs:** `docker compose -f docker-compose.prod.yml logs`

## 🔐 Security Checklist

- [ ] Change all passwords in `.env`
- [ ] Use strong JWT_SECRET (min 32 characters)
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Restrict database access (internal network only)
- [ ] Set up firewall rules
- [ ] Enable automatic security updates
- [ ] Set up log rotation
- [ ] Configure backup strategy

## 💾 Backup Database

```bash
# Create backup
docker compose -f docker-compose.prod.yml exec db pg_dump -U postgres construction_tools > backup_$(date +%Y%m%d).sql

# Restore from backup
cat backup_20260304.sql | docker compose -f docker-compose.prod.yml exec -T db psql -U postgres construction_tools
```

## 📈 Monitoring

```bash
# Resource usage
docker stats

# Container health
docker compose -f docker-compose.prod.yml ps

# Database connections
docker compose -f docker-compose.prod.yml exec db psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

## 🆘 Troubleshooting

### API not starting
```bash
# Check logs
docker compose -f docker-compose.prod.yml logs app

# Restart database
docker compose -f docker-compose.prod.yml restart db

# Check database connection
docker compose -f docker-compose.prod.yml exec app ping db
```

### Database connection issues
```bash
# Check database health
docker compose -f docker-compose.prod.yml exec db pg_isready

# View database logs
docker compose -f docker-compose.prod.yml logs db
```

### Parser errors
```bash
# Run parser with verbose output
docker compose -f docker-compose.prod.yml exec app python3 -u parsers/thtool_parser.py 2>&1 | tee parser.log
```

## 📞 Support

For issues, check:
- Application logs: `logs/`
- Docker logs: `docker compose -f docker-compose.prod.yml logs`
- Nginx logs: `logs/nginx/`
