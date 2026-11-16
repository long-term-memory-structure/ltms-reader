# test/fribidi-lines.py: GNU FriBidi's library (libfribidi, through ctypes) laying out a wrapped paragraph as UAX #9
# section 3.4 says: the paragraph's levels resolved once (fribidi_get_par_embedding_levels_ex, its paired brackets
# from fribidi_get_bracket_types), then each line reordered by itself (fribidi_reorder_line: L1's whitespace at the
# line's end, L2; FRIBIDI_FLAG_REORDER_NSM keeps a mark after its letter, L3), a character at an odd level drawn with its
# mirrored glyph (L4, fribidi_get_mirror_char). The oracle of test/bidi.test.mjs's wrapped paragraphs, run there when
# python3 can load the library (LTMS_READER_LIBFRIBIDI names it, else libfribidi.so.0).
#
# stdin: a JSON object a line, {"cps": [code points], "level": 0 or 1, "lines": [[start, end], ...], "drop": [index, ...]},
# indices in code points; "drop" names characters the caller put in for FriBidi (marks around a path), left out of what
# is written back. stdout: a JSON object a line, {"lines": [[code points, in visual order], ...]}.
# usage: python3 -I test/fribidi-lines.py < requests
import ctypes, json, os, sys

lib = ctypes.CDLL(os.environ.get('LTMS_READER_LIBFRIBIDI') or 'libfribidi.so.0')
U32, I32, I8 = ctypes.c_uint32, ctypes.c_int, ctypes.c_int8
lib.fribidi_get_bidi_types.argtypes = [ctypes.POINTER(U32), I32, ctypes.POINTER(U32)]
lib.fribidi_get_bracket_types.argtypes = [ctypes.POINTER(U32), I32, ctypes.POINTER(U32), ctypes.POINTER(U32)]
lib.fribidi_get_par_embedding_levels_ex.argtypes = [ctypes.POINTER(U32), ctypes.POINTER(U32), I32, ctypes.POINTER(U32), ctypes.POINTER(I8)]
lib.fribidi_get_par_embedding_levels_ex.restype = I8
lib.fribidi_reorder_line.argtypes = [U32, ctypes.POINTER(U32), I32, I32, U32, ctypes.POINTER(I8), ctypes.POINTER(U32), ctypes.POINTER(I32)]
lib.fribidi_reorder_line.restype = I8
lib.fribidi_get_mirror_char.argtypes = [U32, ctypes.POINTER(U32)]
lib.fribidi_get_mirror_char.restype = ctypes.c_int
PAR_LTR, PAR_RTL = 0x110, 0x111
REORDER_NSM = 0x2

for request in sys.stdin:
    if not request.strip():
        continue
    req = json.loads(request)
    cps, drop = req['cps'], set(req.get('drop', []))
    n = len(cps)
    s = (U32 * n)(*cps)
    types, brackets, levels = (U32 * n)(), (U32 * n)(), (I8 * n)()
    lib.fribidi_get_bidi_types(s, n, types)
    lib.fribidi_get_bracket_types(s, n, types, brackets)
    base = U32(PAR_RTL if req['level'] == 1 else PAR_LTR)
    if lib.fribidi_get_par_embedding_levels_ex(types, brackets, n, ctypes.byref(base), levels) == 0:
        sys.exit('fribidi_get_par_embedding_levels_ex failed')
    out = []
    for a, b in req['lines']:
        line_levels = (I8 * n)(*levels)
        visual = (U32 * n)(*cps)
        where = (I32 * n)(*range(n))
        for i in range(a, b):
            if line_levels[i] & 1:
                m = U32(0)
                if lib.fribidi_get_mirror_char(cps[i], ctypes.byref(m)):
                    visual[i] = m.value
        if lib.fribidi_reorder_line(REORDER_NSM, types, b - a, a, base.value, line_levels, visual, where) == 0:
            sys.exit('fribidi_reorder_line failed')
        out.append([visual[i] for i in range(a, b) if where[i] not in drop])
    print(json.dumps({'lines': out}), flush=True)
