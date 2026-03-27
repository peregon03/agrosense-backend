#!/bin/bash
# Script de actualización del servidor AgroSense
# Ejecutar en EC2: bash deploy.sh

set -e

echo "=== AgroSense Deploy ==="

# 1. Ir al directorio del proyecto (ajustar si es diferente)
cd "$(dirname "$0")/.."

# 2. Traer cambios del repositorio
git fetch origin
git pull origin Mike

# 3. Instalar dependencias si cambiaron
cd backed-agrosense
npm install

# 4. Aplicar migración de alertas (si no se hizo aún)
echo ""
echo "IMPORTANTE: Si no corriste la migración aún, ejecuta en psql:"
echo "  psql -U <usuario> -d <base_de_datos> -f migration_alerts.sql"
echo ""

# 5. Reiniciar el servidor con PM2
pm2 restart agrosense

echo "=== Deploy completado ==="
pm2 logs agrosense --lines 20
