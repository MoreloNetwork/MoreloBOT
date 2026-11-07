# Plan mini-kasyna MRL na Discordzie

## Cel

Udostępnić na serwerze Discord proste gry z zakładami w MRL pobieranymi z istniejących portfeli tipów użytkowników.

## Stan implementacji

- Dostępne gry: rzut monetą (`heads`/`tails`), europejska ruletka (`red`/`black`/`0–36`) oraz typowanie końcowych znaków hasha bloku Morelo.
- Komenda `casino` obsługuje komendy tekstowe i slash commands; odpowiedzi są prywatne.
- Wyniki losuje `node:crypto`; wygrane zwracają brutto 2x stawki dla monety/koloru i 36x dla numeru.
- Wager jest zapisywany przed transferem w pliku JSON, a niejednoznaczne transakcje nie są ponawiane automatycznie. Operatorzy z allowlisty mogą przeglądać i rozstrzygać wpisy.
- Pełny zestaw testów przechodzi: 37/37.
- Kasyno jest wyłączone. Lokalna konfiguracja nie ma włącznika ani konta house, więc nie są wykonywane zakłady.
- Gra blokowa zapisuje typy i rozliczenia w `casinoBlockBetsPath` oraz monitoruje wysokość daemon RPC. Wygrane ze wszystkich gier mają trafiać do wspólnego kanału `casinoWinsChannel`. Każdy typ jest zakładem o kwocie wybranej przez użytkownika i pobieranej z jego portfela tipów.
- Obecny prototyp nadal ma `casinoMaxBet`; trzeba usunąć stały limit przed wdrożeniem decyzji o grze bez maksymalnej stawki.
- **Ograniczenie obecnej wersji:** konto house jest indeksem konta w tym samym wallet-RPC, co portfele tipów. Nie spełnia to docelowego wymagania osobnego portfela kasyna. Przed włączeniem zakładów należy wdrożyć odrębny wallet-RPC i PostgreSQL.

## Ustalone zasady

- Saldo użytkownika to rzeczywiste MRL w jego portfelu tipów; nie ma darmowych sald ani codziennych dopłat.
- Każdy przegrany zakład wysyła stawkę do house; zwycięstwo wypłaca kwotę brutto z house.
- Typowanie bloku dotyczy bloku o wysokości zwróconej przez daemon jako następny do wykopania; runda kończy się, gdy ta wysokość zostanie osiągnięta. Typowany suffix to od 1 do 6 znaków hex, a użytkownik może mieć jeden typ na rundę.
- Każdy typ w grze hash jest zakładem: użytkownik wybiera kwotę, która jest pobierana z jego konta portfela tipów i przesyłana do house.
- Robocza tabela brutto to `15 × 16^(n-1)` stawek dla trafionych `n` końcowych znaków (do 6); najwyższe trafione długości są sprawdzane przez zgodność suffixu. To domyślne założenie, które można zmienić przed produkcją.
- Każdy zakład blokowy rezerwuje pełną potencjalną wypłatę i opłatę w obliczeniu dostępnej płynności house. Niejednoznaczne transfery pozostają do ręcznej weryfikacji i nie są automatycznie ponawiane.
- Nie będzie stałego maksymalnego limitu zakładu. Stawka musi mieścić się w dostępnym saldzie gracza, a house musi pokryć maksymalną możliwą wypłatę dla danego zakładu i opłaty. To kontrola wypłacalności, nie ręczny limit stawki.
- Skarbiec kasyna to osobny portfel w `wallets/bank`, obsługiwany przez odrębną instancję wallet-RPC na porcie `38305`.
- Hasło portfela house będzie początkowo puste (`""`); wallet-RPC musi być zbindowany wyłącznie do `127.0.0.1`. Nie przełączać portfela w głównym wallet-RPC. Kasyno pozostaje wyłączone do czasu oceny zabezpieczeń przed użyciem prawdziwych środków.
- `casinoAdminUserIds` ma na razie zawierać wyłącznie ID administratora: `690157533498704062`. Wpisać je lokalnie do `config.js`; nie commitować lokalnej konfiguracji.
- PostgreSQL będzie uruchomiony lokalnie. Backup bazy będzie wykonywany osobnym skryptem PowerShell do `D:\pulpit\morelo\backups\`; Redis nie jest potrzebny na start.
- Weryfikacja przepisów i zasad serwera nie jest obecnie zakresem tego planu.

## Baza danych i backup

- **Lokalny PostgreSQL jako źródło prawdy** dla wagerów, statusów rozliczeń, hashy transakcji i audytu operatorów. Transakcje bazodanowe zapewnią spójne aktualizacje ledgeru, blokadę/serializację zakładów i migracje schematu.
- PostgreSQL nie uczyni transferów wallet-RPC atomowymi. Zachować stanową kolejkę rozliczeń: zapisać zamiar przed transferem, zapisać hash po odpowiedzi portfela, a niejednoznaczne przypadki kierować do ręcznej weryfikacji bez automatycznego retry.
- **Nie dodawać Redis na start.** Nie przechowywać w nim sald ani statusu rozliczenia. Przy pojedynczym procesie bota nie daje istotnej korzyści; można go dodać później do cache/rate limitów lub koordynacji wielu workerów, jeśli pojawi się mierzalna potrzeba.
- Dodać skrypt `scripts/backup-casino-db.ps1` używający `pg_dump`: codzienne kopie z datą/czasem do `D:\pulpit\morelo\backups\`, retencja starych kopii i procedura testowego odtworzenia. Skrypt ma utworzyć katalog, jeśli go brakuje.
- Sekrety połączenia do PostgreSQL przechowywać poza repozytorium; nie dodawać ich do `config.sample.js` ani commitów.

## Kolejne etapy

1. **Oddzielić skarbiec kasyna** — uruchamiać osobny wallet-RPC na `38305` dla portfela `wallets/bank`; nie przełączać walleta używanego do tipów. Początkowo hasło `""`, wyłącznie lokalnie, z RPC dostępnym tylko na loopback. Dodać bezpieczne uruchamianie i zamykanie obu procesów.
2. **Uruchomić lokalny PostgreSQL** — schemat i migracje dla wagerów, blokad/operacji, transakcji stake/payout oraz audytu rozstrzygnięć.
3. **Dodać i sprawdzić backup** — przygotować codzienny backup przez skrypt PowerShell z `pg_dump`, zapisem do `D:\pulpit\morelo\backups\`, retencją i testem odtworzenia; kopie nie mogą trafiać do repozytorium.
4. **Przenieść settlement do dwóch wallet-RPC** — użytkownik wysyła stake z walleta tipów do house; zwycięzca otrzymuje payout z walleta bankowego. Nie wprowadzać stałego maksymalnego zakładu; odrzucać tylko stawki niedostępne dla gracza lub takie, których maksymalnej wypłaty house nie pokryje. Zapewnić serializację, idempotentne przejścia stanów i ręczne uzgadnianie po awarii.
5. **Rozszerzyć testy integracyjne** — mockować oba wallet-RPC i daemon; testować równoległe zakłady, restart w każdym stanie, brak środków, zmianę tipa, idempotencję rozliczenia bloku, timeouty, payout pending i ręczne rozstrzygnięcie.
6. **Próba stagingowa** — uruchomić z małym bankrolliem i ograniczoną allowlistą, sprawdzić transakcje end-to-end oraz procedurę odzyskiwania i odtworzenia backupu.
7. **Włączenie produkcyjne** — po ustaleniu bankrolla, administratora i rezerwy płynności oraz spełnieniu wymogów bezpieczeństwa. `casinoEnabled` pozostaje `false` do tego momentu.

## Decyzje przed wdrożeniem produkcyjnym

1. Jaki bankroll i rezerwę płynności/opłat przeznaczyć na house? Maksymalna wypłata dla pojedynczej liczby w ruletce wynosi 36x stawki.
2. Jaką retencję kopii ustawić w `D:\pulpit\morelo\backups\`? Backup ma być wykonywany raz dziennie.
3. Puste hasło jest decyzją na etap lokalny; przed użyciem prawdziwych środków należy ustalić wymagane zabezpieczenia.
