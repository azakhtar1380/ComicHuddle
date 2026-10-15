import {refreshNativeCatalogState} from '../lib/native-catalog-state';
import {getPool} from '../db/postgres';

try {
 console.log('NATIVE_COVERAGE_REFRESH '+JSON.stringify(await refreshNativeCatalogState()));
} finally {await getPool().end();}
