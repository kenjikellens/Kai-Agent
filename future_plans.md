# Future Tool Proposals for AI Developer Agent

Om de efficiëntie en nauwkeurigheid van een AI-agent in een codebase te vergroten, zouden de volgende tools zeer waardevol zijn:

## 1. `grep_search` (Text Search)
- **Wat het doet**: Zoekt naar specifieke tekstpatronen of regex over het gehele project of binnen specifieke mappen.
- **Waarom handig**: Nu moet ik vaak bestanden één voor één lezen om iets te vinden. Met `grep_search` kan ik direct zien waar een bepaalde functie, variabele of error-string wordt gebruikt zonder alle data te hoeven downloaden/lezen.

## 2. `get_file_tree` (Project Overview)
- **Wat het doet**: Genereert een visuele boomstructuur van de hele directory met informatie over bestandstypen en eventueel grootte.
- **Waarom handig**: Een snelle manier om de architectuur van een project te begrijpen zonder elke map los te hoeven inspecteren.

## 3. `analyze_complexity` (Code Analysis)
- **Wat het doet**: Analyseert bestanden op cyclomatische complexiteit, code smellings en potentiële bugs via statische analyse.
- **Waarom handig**: Ik kan proactief suggesties doen om code te refactoren voordat er problemen ontstaan.

## 4. `run_tests` (Automated Testing)
- **Wat het doet**: Een gespecialiseerde tool die test-frameworks herkent (zoals Jest, Pytest, Vitest) en de resultaten in een gestructureerd formaat teruggeeft.
- **Waarom handig**: Het maakt het makkelijker om na een wijziging direct te verifiëren of de code nog werkt zonder dat ik handmatig commando's hoef te raden.

## 5. `git_manager` (Version Control Integration)
- **Wat het doet**: Specifieke functies voor `git status`, `git diff`, `git commit` en `git checkout`.
- **Waarom handig**: Hoewel ik `run_command` kan gebruiken, biedt een dedicated tool met foutafhandeling en context (zoals wat de huidige branch is) meer zekerheid bij het beheren van wijzigingen.

## 6. `dependency_graph` (Dependency Visualization)
- **Wat het doet**: Brengt de relaties tussen verschillende modules en externe packages in kaart.
- **Waarom handig**: Helpt me begrijpen wat de impact is van het updaten of verwijderen van een bepaalde library.
