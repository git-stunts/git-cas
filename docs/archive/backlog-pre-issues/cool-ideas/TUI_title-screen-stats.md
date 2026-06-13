# Cool Idea: Show vault summary on the title screen

## What
While the title screen loads, show a quick vault stats summary: entry count, total logical size, dedup ratio, encryption status. Makes the "Checking vault..." phase informative instead of a blank wait.

## Why
The metadata check already reads vault state. We can extract basic counts without reading manifests. Gives the operator an instant "health at a glance" before the full dashboard loads.
