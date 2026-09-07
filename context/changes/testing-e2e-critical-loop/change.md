---
change_id: testing-e2e-critical-loop
title: Testing e2e critical loop
status: impl_reviewed
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

**Progress 3.7 pozostaje otwarte i nie da się go zamknąć w obecnym stanie repozytorium.**
Dodanie `e2e` do required status checks gałęzi `master` wymaga branch protection, a ta zwraca 403
(`Upgrade to GitHub Pro or make this repository public`) — repo jest prywatne na planie bez tej funkcji.
Joby `e2e` i `db-tests` biegną na każdym PR i czerwienieją poprawnie, ale nie blokują przycisku merge.
Udokumentowane w `context/foundation/test-plan.md` §7 wraz z warunkiem odwrócenia; przy okazji
skorygowany nieprawdziwy od Fazy 2 zapis, że `db-tests` jest required (§5, §6.4, §6.7 Faza 2).
Migracja repo na publiczne — świadomie odłożona (2026-09-07). Po niej: dodaj `e2e` i `db-tests`
w Settings → Branches, zaznacz 3.7 z SHA `2142a2a` i odwróć wpis §7 wraz z korektami §5/§6.4.
