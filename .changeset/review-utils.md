---
'@novastarter/utils': patch
---

formatTitle keeps acronyms with digits whole (`MP3Player` -> `Mp3 Player`, `M2M` stays `M2M`), spells `FAQs` as listed, and no longer emits doubled, leading or trailing spaces for repeated or edge separators; normalizePath with `removeLeading` also strips the slash of a backslash-rooted path.
