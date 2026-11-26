@echo off
start "" http://127.0.0.1:4600
node "%~dp0server.js"
pause
