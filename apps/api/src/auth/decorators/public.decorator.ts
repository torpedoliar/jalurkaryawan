import { SetMetadata } from '@nestjs/common';
export const PUBLIC_KEY = 'bms:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
