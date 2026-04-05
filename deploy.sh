#!/bin/bash
# Script de actualización del servidor AgroSense
# Ejecutar en EC2: bash backed-agrosense/deploy.sh

set -e
echo "=== AgroSense Deploy ==="

cd "$(dirname "$0")/.."
git fetch origin
git pull origin main

cd backed-agrosense
npm install   # instala nodemailer y demás

echo ""
echo "Verificar que el .env del servidor tenga estas variables para email:"
echo "  EMAIL_HOST=smtp.gmail.com"
echo "  EMAIL_PORT=587"
echo "  EMAIL_USER=tu@gmail.com"
echo "  EMAIL_PASS=xxxx xxxx xxxx xxxx  (App Password de Google)"
echo ""

pm2 restart agrosense
echo "=== Deploy completado ==="
pm2 logs agrosense --lines 15
