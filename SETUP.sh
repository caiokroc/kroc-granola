#!/bin/bash
echo ""
echo "======================================"
echo "  KROC GRANOLA - Setup do Projeto"
echo "======================================"
echo ""

# Step 1: Install dependencies
echo "[1/3] Instalando dependencias..."
npm install
echo ""

# Step 2: Test locally
echo "[2/3] Pronto! Para testar localmente, rode:"
echo "  npm run dev"
echo ""
echo "  Depois abra no navegador: http://localhost:5173"
echo ""

# Step 3: Instructions for deploy
echo "[3/3] Para subir no Vercel:"
echo "  1. Crie um repo no GitHub: https://github.com/new"
echo "  2. Nome: kroc-granola"
echo "  3. Depois rode estes comandos:"
echo ""
echo "     git init"
echo "     git add ."
echo '     git commit -m "Kroc Granola site"'
echo "     git branch -M main"
echo "     git remote add origin https://github.com/SEU_USUARIO/kroc-granola.git"
echo "     git push -u origin main"
echo ""
echo "  4. Va em vercel.com, entre com GitHub"
echo "  5. Importe o repo kroc-granola"
echo "  6. Clique Deploy"
echo ""
echo "======================================"
