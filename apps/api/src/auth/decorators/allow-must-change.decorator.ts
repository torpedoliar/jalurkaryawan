import { SetMetadata } from '@nestjs/common';
export const ALLOW_MUST_CHANGE_KEY = 'bms:allowMustChange';
export const AllowMustChange = () => SetMetadata(ALLOW_MUST_CHANGE_KEY, true);
