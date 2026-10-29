import { plainToInstance } from 'class-transformer';
import { AdminUpdatePromoCodeDto } from '../../promo/dto/promo-code.dto';
import { definedOnly } from './defined-only';

describe('definedOnly', () => {
  it('keeps what a PATCH sent, not the DTO class’s undeclared undefineds', () => {
    // What ValidationPipe({ transform: true }) hands a controller.
    const dto = plainToInstance(AdminUpdatePromoCodeDto, { isActive: false });
    const merged = { code: 'SALE10', isActive: true, ...definedOnly(dto) };
    expect(merged).toEqual({ code: 'SALE10', isActive: false });
  });

  it('keeps null, which clears a value on update', () => {
    expect(definedOnly({ maxUses: null, endsAt: undefined })).toEqual({
      maxUses: null,
    });
  });
});
