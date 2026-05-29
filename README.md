# 4chan-NeverTwice

A browser [userscript](https://en.wikipedia.org/wiki/Userscript) to detect and hide repetitive 4chan threads.

# How it works

1. You visit the catalog on 4chan
2. The script generates a [SimHash](https://en.wikipedia.org/wiki/SimHash) for every thread.
3. Every thread is compared against hashes already seen.
4. If a post is very similar to a previous post, it will be marked or hidden (configurable in the script).

Over time, your index of seen posts will grow, and the script's ability to detect repeat, low-value posts will grow. Posts older than 90 days (configurable) are forgotten.

No data is sent externally, the script builds up a local index over time and applies it as you browse.

# Install

Basic install guide should be valid for Firefox, Chrome, or any of their derivatives (Edge, LibreWolf etc.)

1. Install Violentmonkey or Tampermonkey extension
2. Import the NeverTwice script into the extension
3. Browse to the catalog page of any board on 4chan

# Configuration

At the top of the script you'll find some easily configurable elements:
 - [HAMMING_THRESHOLD](https://en.wikipedia.org/wiki/Hamming_distance) - How similar posts have to be to match. Lower = must be more similar.
 - PRUNE_DAYS - How many days to keep hashes for threads you've seen. Bigger is better for matching dupes, unless you encounter performance/storage issues from having too many :)
 - MODE - Valid choices are 'hide' or 'mark'. Choose if you want duplicates to be hidden or just marked with a really obnoxious red outline
 - CROSS_BOARD_CHECK - If 1 (true), posts will be compared against hashes of posts from ALL boards. If 0 (false), posts will only be checked against hashes from the same board

# Notes

NeverTwice is compatible with, but not dependent on, [4Chan-X](https://github.com/ccd0/4chan-x).

Some effort has been made to detect and permit 'General' threads, which are deliberately repetitive. It's not perfect, but it should catch all but the laziest generals.

# Troubleshooting
If you're encountering false positives or other issues with the script running:
1. Set const DEBUG = true at the top of the script
2. On the catalog page, hit F12 in the browser to open the developer console
3. Set the console filter to '[NeverTwice]' to view log information from the script
