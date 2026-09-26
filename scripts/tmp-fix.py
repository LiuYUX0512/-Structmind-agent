# -*- coding: utf-8 -*-
import io
p = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\components\StructureWireframe3D.tsx'
s = io.open(p, encoding='utf-8').read()
old = "fire?: { checks?: Array<{ item?: string; status: string; clauseText?: string }> }"
new = "fire?: { checks?: Array<{ item?: string; name?: string; status: string; clauseText?: string }> }"
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK fire-type-fix')
