# Bundled Telugu fonts

Static Noto Sans Telugu Regular, Medium, SemiBold and Bold TTF files are bundled
for offline/native use and predictable Expo font-weight selection.

Source: Google Fonts Noto Sans Telugu, v30 static full-script TTFs, obtained from
https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;500;600;700
with a generic browser user agent. Unlike the older script-only Noto builds,
these assets include Latin glyphs for mixed Telugu/English native text.

License: SIL Open Font License 1.1; see OFL.txt.

The Customer loads these via its existing expo-font mechanism. Dashboard CSS
loads the same assets through package exports. Inter remains the English font.
Fontconfig confirms family/weight metadata and Telugu/ASCII cmap coverage;
web preview rendering and physical Android/iOS checks are separate acceptance
steps, not implied by cmap validation.
