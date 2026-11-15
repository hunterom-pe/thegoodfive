-- Curation of the starter photo library. Run AFTER photo_library_seed.sql. Safe to run more than once.
-- 1. Removes photos that were irrelevant or likely to mislead (textures, hearts, pills, shopping trolleys, vegetables as 'health', etc.).
-- 2. Sets keywords from each photo's real subject (plus synonyms), never from the search used to find it.
-- 3. Marks ONLY neutral scenes (landscapes, skylines, village streets, a hospital corridor) as 'generic':
--    usable for an ordinary story in the category with no better match. Everything else must match the story's subject.
-- Rollback: re-running photo_library_seed.sql restores deleted rows (ON CONFLICT DO NOTHING) but does not reset keywords/generic;
-- to undo those, run: update public.photo_library set generic = true;  (the seed's original setting).

delete from public.photo_library where unsplash_id in ('MhLjFJi3fRY', 'ASLCTXscn4I', 'PAO2ZtOR8N0', 'AtV1Je2whvk', 'X-OZDHpjBwk', 'ssZ6x-gaO0c', 'w8p9cQDLX7I', 'YzBSMukvJVY', 'ZCO_5Y29s8k', 'aef71KyW0JI', 'SAPvKo12dQE', 'qgHGDbbSNm8', 'cAtzHUz7Z8g', '0EVKn3-5JSU', 'c5eZJlmVjd4');

update public.photo_library set generic = false;

update public.photo_library set keywords = array['coral', 'reef', 'ocean', 'marine', 'underwater', 'sea', 'fish', 'atolls', 'sanctuary']::text[] where unsplash_id = 'HYHYGLs-Rp8';
update public.photo_library set keywords = array['coral', 'reef', 'ocean', 'marine', 'underwater', 'sea', 'fish', 'atolls', 'sanctuary']::text[] where unsplash_id = '7AmBaTymwJg';
update public.photo_library set keywords = array['coral', 'reef', 'ocean', 'marine', 'underwater', 'sea', 'fish', 'atolls', 'sanctuary']::text[] where unsplash_id = 'DnLtZfBSjcU';
update public.photo_library set keywords = array['stars', 'astronomy', 'space', 'galaxy', 'universe', 'cosmos']::text[] where unsplash_id = 'gEerTElo2mc';
update public.photo_library set keywords = array['stars', 'astronomy', 'space', 'galaxy', 'universe', 'cosmos']::text[] where unsplash_id = '8G8YDIy2sx8';
update public.photo_library set keywords = array['earth', 'space', 'planet', 'orbit', 'satellite', 'climate', 'globe', 'mars', 'martian', 'rover', 'cosmos']::text[] where unsplash_id = 'OCe8cTGymSQ';
update public.photo_library set keywords = array['earth', 'space', 'planet', 'orbit', 'satellite', 'climate', 'globe', 'mars', 'martian', 'rover', 'cosmos']::text[] where unsplash_id = 'Jn2EaLLYZfY';
update public.photo_library set keywords = array['earth', 'space', 'planet', 'orbit', 'satellite', 'climate', 'globe', 'mars', 'martian', 'rover', 'cosmos']::text[] where unsplash_id = 'yZygONrUBe8';
update public.photo_library set keywords = array['telescope', 'dish', 'radio', 'astronomy', 'observatory', 'antenna']::text[], shows_people = false where unsplash_id = '3YAIvBNlZM4';
update public.photo_library set keywords = array['crystal', 'crystals', 'mineral', 'physics', 'materials', 'optics']::text[] where unsplash_id = 'ymQlshzTVv0';
update public.photo_library set keywords = array['wind', 'turbines', 'windmills', 'energy', 'renewable', 'power', 'clean']::text[] where unsplash_id = 'baXCV2qg9Ew';
update public.photo_library set keywords = array['wind', 'turbines', 'windmills', 'energy', 'renewable', 'power', 'clean']::text[] where unsplash_id = '8NBACfGMFtw';
update public.photo_library set keywords = array['wind', 'turbines', 'windmills', 'energy', 'renewable', 'power', 'clean']::text[] where unsplash_id = '4NhqyQeErP8';
update public.photo_library set keywords = array['solar', 'panels', 'energy', 'renewable', 'rooftop', 'power']::text[] where unsplash_id = 'Ja8t8nJN2I4';
update public.photo_library set keywords = array['solar', 'panels', 'energy', 'renewable', 'rooftop', 'power']::text[] where unsplash_id = 't-rzp15L7qg';
update public.photo_library set keywords = array['solar', 'panels', 'energy', 'renewable', 'rooftop', 'power']::text[] where unsplash_id = 'wmaP3Tl80ww';
update public.photo_library set keywords = array['railway', 'bridge', 'train', 'rail', 'transport', 'infrastructure']::text[] where unsplash_id = 'gNqX47ax2U4';
update public.photo_library set keywords = array['railway', 'bridge', 'train', 'rail', 'transport', 'infrastructure']::text[] where unsplash_id = 'AkLj_8Z3fAE';
update public.photo_library set keywords = array['railway', 'bridge', 'train', 'rail', 'transport', 'infrastructure']::text[] where unsplash_id = 'zbEhOXfKvFQ';
update public.photo_library set keywords = array['water', 'drinking', 'clean', 'sanitation', 'tap']::text[] where unsplash_id = 'SVeCm5KF_ho';
update public.photo_library set keywords = array['water', 'drinking', 'clean', 'sanitation', 'tap']::text[] where unsplash_id = 'MUOhSYEqbHo';
update public.photo_library set keywords = array['water', 'drinking', 'clean', 'sanitation', 'tap']::text[] where unsplash_id = 'KOh8ShapWMw';
update public.photo_library set keywords = array['school', 'bus', 'education', 'transport', 'students']::text[] where unsplash_id = 'ZdbqQWLqKM0';
update public.photo_library set keywords = array['market', 'stalls', 'shoppers', 'food', 'vendors', 'trade']::text[] where unsplash_id = 'y7t1xsahSaE';
update public.photo_library set keywords = array['market', 'stalls', 'shoppers', 'food', 'vendors', 'trade']::text[] where unsplash_id = 'j8deK7ZkIOU';
update public.photo_library set keywords = array['market', 'stalls', 'shoppers', 'food', 'vendors', 'trade']::text[] where unsplash_id = 'yBw4DGU1inI';
update public.photo_library set keywords = array['books', 'library', 'reading', 'shelves', 'literacy', 'education']::text[] where unsplash_id = '2JIvboGLeho';
update public.photo_library set keywords = array['books', 'library', 'reading', 'shelves', 'literacy', 'education']::text[] where unsplash_id = 'sd8uJsf4XM4';
update public.photo_library set keywords = array['books', 'library', 'reading', 'shelves', 'literacy', 'education']::text[] where unsplash_id = 'BEEyeib-am8';
update public.photo_library set keywords = array['garden', 'planting', 'seedlings', 'gardening']::text[] where unsplash_id = 'q13Zq1Jufks';
update public.photo_library set keywords = array['garden', 'planting', 'seedlings', 'gardening']::text[] where unsplash_id = 'bY_q4VodUc0';
update public.photo_library set keywords = array['laboratory', 'microscope', 'research', 'cells', 'biology', 'chemistry', 'glassware', 'beaker']::text[] where unsplash_id = 'cuqp2Jzz_lY';
update public.photo_library set keywords = array['laboratory', 'microscope', 'research', 'cells', 'biology', 'chemistry', 'glassware', 'beaker']::text[] where unsplash_id = 'JxoWb7wHqnA';
update public.photo_library set keywords = array['laboratory', 'microscope', 'research', 'cells', 'biology', 'chemistry', 'glassware', 'beaker']::text[] where unsplash_id = 'SyUrj2dO_H0';
update public.photo_library set keywords = array['laboratory', 'microscope', 'research', 'cells', 'biology', 'chemistry', 'glassware', 'beaker']::text[] where unsplash_id = 'gxHT8JuIbgQ';
update public.photo_library set keywords = array['laboratory', 'microscope', 'research', 'cells', 'biology', 'chemistry', 'glassware', 'beaker']::text[] where unsplash_id = 'Rl9bIWKCVF0';
update public.photo_library set keywords = array['laboratory', 'microscope', 'research', 'cells', 'biology', 'chemistry', 'glassware', 'beaker']::text[] where unsplash_id = '1PpyUZceg_I';
update public.photo_library set keywords = array['vegetables', 'nutrition', 'diet', 'healthy', 'food']::text[] where unsplash_id = 'Zaiuy5dKeCk';
update public.photo_library set keywords = array['vegetables', 'nutrition', 'diet', 'healthy', 'food']::text[] where unsplash_id = 'vO1h-ZUlSKM';
update public.photo_library set keywords = array['running', 'exercise', 'fitness', 'trail', 'yoga', 'stretching']::text[] where unsplash_id = 'I1EWTM5mFEM';
update public.photo_library set keywords = array['running', 'exercise', 'fitness', 'trail', 'yoga', 'stretching']::text[] where unsplash_id = 'MFCzJQoFXzc';
update public.photo_library set keywords = array['running', 'exercise', 'fitness', 'trail', 'yoga', 'stretching']::text[] where unsplash_id = 'mQVWb7kUoOE';
update public.photo_library set keywords = array['running', 'exercise', 'fitness', 'trail', 'yoga', 'stretching']::text[] where unsplash_id = 'VpV3iF2eZuA';
update public.photo_library set keywords = array['running', 'exercise', 'fitness', 'trail', 'yoga', 'stretching']::text[] where unsplash_id = 'G9H5edUL0T8';
update public.photo_library set keywords = array['pills', 'medicine', 'medication']::text[] where unsplash_id = 'cPgxkFYNx-s';
update public.photo_library set keywords = array['lake', 'forest', 'trees', 'woodland', 'scenery']::text[] where unsplash_id = 'JiJokTTaCJE';
update public.photo_library set keywords = array['mountains', 'lake', 'trees', 'scenery']::text[] where unsplash_id = 'JLl83G_pFpc';
update public.photo_library set keywords = array['river', 'forest', 'woodland', 'scenery']::text[] where unsplash_id = 'j5gMzGw7FgQ';
update public.photo_library set keywords = array['lake', 'mountains', 'scenery']::text[] where unsplash_id = 'z_f2JrBRbOg';
update public.photo_library set keywords = array['hills', 'grassland', 'countryside', 'farmland', 'scenery']::text[] where unsplash_id = '4so672vwNIY';
update public.photo_library set keywords = array['hills', 'grassland', 'countryside', 'farmland', 'scenery']::text[] where unsplash_id = 'S_bNa0tlPG0';
update public.photo_library set keywords = array['laboratory', 'flasks', 'glassware', 'chemistry', 'research']::text[] where unsplash_id = 'iMe4s65BJmQ';
update public.photo_library set keywords = array['laboratory', 'workbench', 'microscope', 'equipment', 'research']::text[] where unsplash_id = '_9xRHrMOjeg';
update public.photo_library set keywords = array['hospital', 'corridor', 'clinic', 'ward', 'healthcare']::text[] where unsplash_id = 'Pk-KuizxQv8';
update public.photo_library set keywords = array['street', 'cobblestone', 'houses', 'town', 'village', 'heritage']::text[] where unsplash_id = 'hQ8oPJuyIag';
update public.photo_library set keywords = array['village', 'street', 'houses', 'neighbourhood', 'community']::text[] where unsplash_id = 'plRKdmaF0ZU';
update public.photo_library set keywords = array['village', 'street', 'houses', 'neighbourhood', 'community']::text[] where unsplash_id = 'WH6C_fxTbyQ';
update public.photo_library set keywords = array['city', 'skyline', 'urban', 'cities']::text[] where unsplash_id = 'XfpSr1OBtio';
update public.photo_library set keywords = array['city', 'skyline', 'urban', 'cities']::text[] where unsplash_id = 'Vq1lxH5TeQ0';
update public.photo_library set keywords = array['city', 'skyline', 'urban', 'cities']::text[] where unsplash_id = 'vL9V8ilDLCQ';
update public.photo_library set keywords = array['birds', 'flock', 'wetland', 'migration', 'waterbirds', 'flying']::text[] where unsplash_id = 'ZCM-fJl30zI';
update public.photo_library set keywords = array['wildflowers', 'flowers', 'meadow', 'grass', 'pollinators', 'bees']::text[] where unsplash_id = 'OyYc6pZsWnk';
update public.photo_library set keywords = array['wildflowers', 'flowers', 'meadow', 'grass', 'pollinators', 'bees']::text[] where unsplash_id = '6LJqVhPtjEU';
update public.photo_library set keywords = array['waterfall', 'forest', 'stream']::text[] where unsplash_id = 'WcQdda6ZXjE';
update public.photo_library set keywords = array['mountains', 'lake', 'snow', 'peaks', 'clouds']::text[] where unsplash_id = 'vZ1JAXUO3-0';
update public.photo_library set keywords = array['mountains', 'lake', 'snow', 'peaks', 'clouds']::text[] where unsplash_id = 'INVi7be11S8';
update public.photo_library set keywords = array['building', 'office', 'architecture', 'modern', 'construction']::text[] where unsplash_id = '1deQbU6DhBg';
update public.photo_library set keywords = array['team', 'unity', 'teamwork', 'together']::text[] where unsplash_id = 'UdDjFekHQuk';

update public.photo_library set generic = true where unsplash_id in ('4so672vwNIY', 'JLl83G_pFpc', 'JiJokTTaCJE', 'Pk-KuizxQv8', 'S_bNa0tlPG0', 'Vq1lxH5TeQ0', 'WH6C_fxTbyQ', 'XfpSr1OBtio', 'hQ8oPJuyIag', 'j5gMzGw7FgQ', 'plRKdmaF0ZU', 'vL9V8ilDLCQ', 'z_f2JrBRbOg');
