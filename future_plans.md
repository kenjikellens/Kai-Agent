# Future Tool Proposals for AI Developer Agent

Om de efficiëntie en nauwkeurigheid van een AI-agent in een codebase te vergroten, zijn de volgende tools voorgesteld, gerangschikt van meest belangrijk/handig naar minst belangrijk/handig:

## 1. `grep_search` (Text Search) - **Prioriteit: Zeer Hoog**
- **Wat het doet**: Zoekt naar specifieke tekstpatronen of regex over het gehele project of binnen specifieke mappen.
- **Waarom handig**: Voorkomt dat de agent bestanden één voor één moet lezen om iets te vinden. Met `grep_search` kan de agent direct zien waar een bepaalde functie, variabele of error-string wordt gebruikt.

## 2. `replace_file_content` & `multi_replace_file_content` (Structured Code Edits) - **Prioriteit: Zeer Hoog**
- **Wat het doet**:
  - `replace_file_content`: Bewerkt één aaneengesloten blok code door parameters zoals `StartLine`, `EndLine`, `TargetContent` en `ReplacementContent` te gebruiken. De tool controleert of de te vervangen code exact overeenkomt binnen het aangegeven regelbereik.
  - `multi_replace_file_content`: Maakt het mogelijk om meerdere, niet-aaneengesloten stukken code in hetzelfde bestand in één keer aan te passen via losse vervangings-chunks.
- **Waarom handig**: LLM's maken vaak fouten met witruimte of missen exacte matches bij grote bestanden. Door te zoeken binnen een specifiek regelbereik met inhoudsverificatie worden bewerkingen veel robuuster en mislukken ze zelden.

## 3. `run_tests` (Automated Testing) - **Prioriteit: Hoog**
- **Wat het doet**: Voert testframeworks (zoals Jest, Pytest, Vitest) uit en geeft de resultaten in een compact, gestructureerd formaat terug.
- **Waarom handig**: Maakt het mogelijk om direct na een codewijziging te verifiëren of de code werkt zonder dat de agent handmatige terminalcommando's hoeft te raden of grote logs moet doorspitten.

## 4. `view_symbol_definition` (Code Navigation) - **Prioriteit: Hoog**
- **Wat het doet**: Gebruikt VS Code Language Services om direct de definitie of referenties van een klasse, interface of functie op te vragen.
- **Waarom handig**: De agent kan hiermee direct naar de broncode van geïmporteerde symbolen springen, vergelijkbaar met de *F12 / Go to Definition* functionaliteit in de editor.

## 5. `get_file_tree` (Project Overview) - **Prioriteit: Medium-Hoog**
- **Wat het doet**: Genereert een recursieve mappenstructuur van de directory met informatie over bestandstypen.
- **Waarom handig**: Een snelle manier om de architectuur en hiërarchie van een project te begrijpen zonder elke map los te hoeven inspecteren met `list_dir`.

## 6. `git_manager` (Version Control Integration) - **Prioriteit: Medium**
- **Wat het doet**: Biedt gestructureerde integratie voor `git status`, `git diff` en `git commit`.
- **Waarom handig**: Hoewel commando's via `run_command` kunnen, zorgt een specifieke tool voor veiligheid en betrouwbaarheid bij het committen en controleren van wijzigingen.

## 7. `dependency_graph` (Dependency Visualization) - **Prioriteit: Laag-Medium**
- **Wat het doet**: Brengt de relaties tussen verschillende modules en externe packages in kaart.
- **Waarom handig**: Helpt de agent begrijpen wat de impact is van het aanpassen of verwijderen van een bepaalde module of library.

## 8. `ask_user` (User Confirmation / Interactive Clarification) - **Prioriteit: Zeer Hoog**
- **Wat het doet**: Maakt het mogelijk om gestructureerde vragen of keuzemenu's aan de gebruiker voor te leggen tijdens de uitvoering.
- **Waarom handig**: Voorkomt dat de agent aannames moet doen bij onduidelijke eisen of dat risicovolle acties onbedoeld direct worden uitgevoerd.

## 9. Context Summarization & Multi-Step Memory - **Prioriteit: Zeer Hoog**
- **Wat het doet**: Automatisch samenvatten van eerdere tool-outputs en chatgeschiedenis wanneer het context window vol raakt.
- **Waarom handig**: Voorkomt dat de agent na 10 iteraties vastloopt of belangrijke details uit het begin van de sessie vergeet.

## 10. `create_dir` (Directory Creation) - **Prioriteit: Hoog**
- **Wat het doet**: Maakt expliciet nieuwe mappenstructuren (inclusief parent directories) aan in de workspace.
- **Waarom handig**: `write_file` faalt momenteel als de doelmap nog niet bestaat. Met deze tool kan de agent schone projectstructuren opzetten.

## 11. `rename_item` (File / Directory Move & Rename) - **Prioriteit: Hoog**
- **Wat het doet**: Hernoemt of verplaatst een bestand/map naar een nieuw pad binnen de workspace.
- **Waarom handig**: Voorkomt dat de agent een bestand moet kopiëren en het oude bestand moet verwijderen, wat risico op dataverlies geeft.

## 12. `diff_view` (Interactive Diff Preview) - **Prioriteit: Medium-Hoog**
- **Wat het doet**: Genereert een visualisatie van voorgestelde codewijzigingen in een VS Code diff editor voordat de wijzigingen definitief worden opgeslagen.
- **Waarom handig**: Geeft de gebruiker volledige controle over wat er veranderd wordt (vergelijkbaar met inline edit).

## 13. Conversation Branching & Rollback - **Prioriteit: Medium**
- **Wat het doet**: Maakt het mogelijk om af te takken vanaf een eerder punt in de chatgeschiedenis of een chat-state terug te draaien.
- **Waarom handig**: Indien een agent een verkeerd pad inslaat, kan de gebruiker eenvoudig terugstappen naar een eerdere beurt zonder de hele chat te verliezen.

## 14. Robust Error Recovery & Retry Protocol - **Prioriteit: Medium**
- **Wat het doet**: Een gestructureerd mechanisme waarbij de agent bij een mislukte tool-call automatisch een diagnose stelt en een alternatieve strategie kiest.
- **Waarom handig**: Voorkomt dat de agent vastloopt in herhaalde tool-fouten of dezelfde mislukte parameters opnieuw probeert.

## 15. Multimodal / Image Inspection Tool - **Prioriteit: Laag-Medium**
- **Wat het doet**: Maakt het mogelijk voor de agent om afbeeldingen, UI-mockups en gegenereerde screenshots te inspecteren en analyseren.
- **Waarom handig**: Onmisbaar bij frontend development om te verifiëren of de visuele weergave overeenkomt met het ontwerp.

## 16. `undo_last_edit` (File Edit Rollback) - **Prioriteit: Laag-Medium**
- **Wat het doet**: Maakt de meest recente bestandsbewerking van de agent ongedaan (git checkout of backup restore).
- **Waarom handig**: Biedt een snelle hersteloptie als een `replace_file_content` of `write_file` de code breekt.

## 17. Workspace Code Indexing & Semantic Search - **Prioriteit: Laag-Medium**
- **Wat het doet**: Indexeert de codebase semantisch (embeddings) voor slimme vector-gebaseerde zoekopdrachten.
- **Waarom handig**: Maakt het mogelijk om code te vinden op basis van concepten en intentie in plaats van exacte trefwoorden (`grep_search`).
