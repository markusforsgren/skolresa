# Klassmålet

Röstningssajt för klassresor. En vuxen skapar konto, lägger in klassen och resmålen, och delar en kod/länk/QR med eleverna. Eleverna röstar utan konto.

## Filer

| Fil | Vad |
|---|---|
| `index.html` | Startsida – elever skriver in klasskod |
| `klass.html` + `js/klass.js` | Elevsidan (`/k/KOD`): rösta, kostnader, insamling |
| `admin.html` + `js/admin.js` | Adminpanel: konto, klasser, resmål, resultat, kostnader, insamling, dela |
| `js/config.js` | Supabase-adress och nyckel |
| `js/templates.js` | Färdiga resmål och försäljningsförslag |
| `supabase/schema.sql` | Databas, säkerhetsregler och funktioner |
| `netlify.toml` | Gör att `/k/ABC123` fungerar |

## Sätta igång (ca 15 min)

### 1. Supabase
1. Öppna projektet på supabase.com (eller skapa ett nytt – byt då URL och anon-nyckel i `js/config.js`).
2. **SQL Editor → New query** → klistra in hela `supabase/schema.sql` → **Run**.
   Skapar tabellerna `km_classes`, `km_destinations`, `km_votes`, `km_sales` och bild-bucketen `km-images`. De gamla tabellerna `votes` och `cost_settings` rörs inte.
3. **Authentication → URL Configuration**
   - Site URL: `https://xn--klassmlet-b3a.se`
   - Redirect URLs: lägg till `https://xn--klassmlet-b3a.se/admin.html` (och din Netlify-adress, t.ex. `https://DITTNAMN.netlify.app/admin.html`)
4. **Authentication → Providers → Email**: låt "Confirm email" vara på.
5. (Valfritt) **Authentication → Email Templates**: översätt mejlen till svenska.

### 2. GitHub + Netlify
1. Ersätt innehållet i repot `skolresa` med alla filer härifrån (behåll mappstrukturen).
2. Netlify bygger automatiskt. Publish directory = roten (`.`), inget byggkommando.
3. Kolla att domänen `klassmålet.se` pekar på sajten.

### 3. Testa
1. Gå till `/admin.html` → Skapa konto → bekräfta via mejlet.
2. Skapa en klass → välj några förslag → Dela → öppna länken i mobilen och rösta.

## Så fungerar säkerheten
- Varje vuxen ser och ändrar bara sina egna klasser (Row Level Security).
- Elever har ingen direkt åtkomst till tabellerna. De går via två funktioner: `km_get_class` (hämtar bara det som admin valt att visa) och `km_cast_vote` (ett namn = en röst per klass, kontrolleras i databasen).
- Elevernas namn syns aldrig publikt – bara för admin.
- Klasskoden kan bytas om den sprids fel.

## Betalning (förberett)
`km_classes.paid` och `paid_at` finns men används inte än. Kunden kan inte sätta dem själv (triggern blockerar det). När betalning ska in: Stripe/Swish → webhook (Supabase Edge Function med service role) som sätter `paid = true`, och adminpanelen låser t.ex. delning tills klassen är betald.
