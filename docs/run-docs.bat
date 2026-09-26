@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  智构 StructMind 参赛材料一键生成
echo ============================================
python gen-docs.py
if errorlevel 1 (
  echo.
  echo [提示] 若提示缺少 python，请先安装 Python 3（勾选 Add to PATH）。
  pause
  exit /b 1
)
echo.
echo 生成完成！两份 Word 文档在 docs 文件夹中。
pause
