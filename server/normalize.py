"""One normalisation function, used by everything that compares names.

Merge conflict detection (D4), TMDB/IGDB person matching, and the guild-unique
name indexes must all agree on what "the same name" is, or a merge will create a
duplicate the importer then refuses to create. Accent-, case-, punctuation- and
whitespace-insensitive.
"""
from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[^\w\s]+", re.UNICODE)
_WS = re.compile(r"\s+")


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str | None) -> str:
    if not s:
        return ""
    return _WS.sub(" ", _PUNCT.sub(" ", strip_accents(s).casefold())).strip()


def norm_or_none(s: str | None) -> str | None:
    return norm(s) or None


def names_conflict(a_name: str, a_en: str | None, b_name: str, b_en: str | None) -> bool:
    """D4: either field may collide with either field."""
    left = {n for n in (norm(a_name), norm_or_none(a_en)) if n}
    right = {n for n in (norm(b_name), norm_or_none(b_en)) if n}
    return bool(left & right)
