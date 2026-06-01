# Never Twice for 4Chan

A [userscript](https://en.wikipedia.org/wiki/Userscript) to automatically hide repetitive 4chan threads.

# How it works

1. You browse the catalog on 4chan
2. The script stores a small [hash](https://en.wikipedia.org/wiki/SimHash) of each thread.
3. Threads are hidden if too similar to one you've seen before.

Over time the store of known threads will grow, and you will see fewer repetitive posts.

No data is sent externally, thread hashes are generated, stashed, and compared on your local machine.

# Install

On Firefox, Chrome, or any derivative (Edge, LibreWolf etc.):

1. Install ViolentMonkey ([Firefox](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/), [Chrome](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)) or TamperMonkey ([Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/), [Chrome](https://chrome.google.com/webstore/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo)) browser extension.
2. Click this link to install the [NeverTwice script](https://github.com/br33zy59/4chan-NeverTwice/raw/refs/heads/main/4chan%20NeverTwice.user.js) into the extension.
3. Browse to the catalog page of any board on 4chan. The script will quietly index threads and hide any duplicates it finds.

You can validate that the script is working by bringing up the browser developer console (F12) and looking for [NeverTwice] in the output. 

# Options

At the top of the script you'll find some configurable elements:
 - [HAMMING_THRESHOLD](https://en.wikipedia.org/wiki/Hamming_distance) - How similar threads have to be to match. Lower = must be more similar.
 - PRUNE_DAYS - How many days (default 90) to remember threads. Bigger is better for matching dupes, but the tradeoff is storage space and processing speed.
 - MODE - Valid choices are 'hide' (default) or 'mark'. Choose if you want duplicates to be hidden or just marked with a really obnoxious red outline.
 - CROSS_BOARD_CHECK - If 1 (default), threads will be compared across ALL boards. If a thread is similar to one on a different board, it will be hidden. If 0, threads will only be compared within each board.

# Notes

- NeverTwice is compatible with (but not dependent on) [4Chan-X](https://github.com/ccd0/4chan-x).
- Some effort has been made to detect and permit 'General' threads, which are deliberately repetitive. It's not perfect, but it should catch most generals.
- The script does not factor images when determining thread uniqueness. It goes off the thread title and first post text alone.

# Troubleshooting
If you're encountering false positives or other issues with the script running:
1. Set DEBUG = true at the top of the script
2. On a catalog page, hit F12 in the browser to open the developer console
3. Set the console filter to '[NeverTwice]' to view log information from the script
4. You can view the store of threads with dumpNeverTwiceDB() and purge it with clearNeverTwiceDB() - Just paste them into the developer console.
