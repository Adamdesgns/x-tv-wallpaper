@echo off
rem Starts the X TV feeder in the background (safe to run twice: a second copy exits).
rem First time: an Edge window opens on X's login page. Log in there; it minimizes itself after.
wscript "%~dp0feeder\start-hidden.vbs"
