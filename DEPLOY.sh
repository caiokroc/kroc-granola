#!/bin/bash
echo ""
echo "=== KROC GRANOLA - Deploy ==="
echo ""

# Remove old git if exists
rm -rf .git

# Fresh git init
git init
git add .
git commit -m "Kroc Granola - atualizado"
git branch -M main

# Set remote and force push
git remote add origin https://github.com/caiokroc/kroc-granola.git
git push -u origin main --force

echo ""
echo "=== Deploy concluido! ==="
echo "Espere 2 min e acesse: https://kroc-granola.vercel.app"
echo ""
