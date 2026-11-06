@echo off
rem Starts the X TV feeder in the background (safe to run twice: a second copy exits).
rem First time: a plain Edge window opens on X's login page. Log in, then close that window;
rem the feeder takes over and keeps its own window off-screen.
wscript "%~dp0feeder\start-hidden.vbs"
