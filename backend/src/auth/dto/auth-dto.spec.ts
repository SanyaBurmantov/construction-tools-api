import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';
import { AdminCreateUserDto, AdminUpdateUserDto } from './admin-user.dto';
import { UpdateProfileDto } from './update-profile.dto';

/** The optional profile fields, seen structurally so one table can mix DTOs. */
type ProfileFields = {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  taxId?: string;
};

/** What the field names in a failed validation look like, for readable assertions. */
function failedFields(dto: object) {
  return validateSync(dto, { whitelist: true }).map((error) => error.property);
}

/**
 * A blank optional field is "not filled in", not a value.
 *
 * Both forms submit every input they own, so an untouched optional field
 * arrives as `''` — which `@IsOptional()` does not skip. Creating an admin
 * with nothing but a login and a password answered with four length errors at
 * once (name, phone, companyName, taxId), and the same shape of payload comes
 * from the storefront's registration form.
 */
describe.each([
  {
    name: 'RegisterDto',
    Dto: RegisterDto,
    required: {
      login: 'customer@mail.by',
      password: 'test-1111',
      customerType: 'INDIVIDUAL',
    },
  },
  {
    name: 'AdminCreateUserDto',
    Dto: AdminCreateUserDto,
    required: { login: 'manager', password: 'test-1111' },
  },
])('$name blank optional fields', ({ Dto, required }) => {
  const blank = {
    name: '',
    email: '',
    phone: '',
    companyName: '',
    taxId: '',
  };

  it('accepts a form that left every optional field empty', () => {
    expect(
      failedFields(
        plainToInstance(Dto as ClassConstructor<ProfileFields>, {
          ...required,
          ...blank,
        }),
      ),
    ).toEqual([]);
  });

  it('drops the blanks instead of storing them', () => {
    const dto = plainToInstance(Dto as ClassConstructor<ProfileFields>, {
      ...required,
      ...blank,
    });
    expect(dto.name).toBeUndefined();
    expect(dto.companyName).toBeUndefined();
    expect(dto.taxId).toBeUndefined();
  });

  // Whitespace is still nothing typed in.
  it('treats a whitespace-only field as empty', () => {
    const dto = plainToInstance(Dto as ClassConstructor<ProfileFields>, {
      ...required,
      ...blank,
      companyName: '   ',
    });
    expect(failedFields(dto)).toEqual([]);
    expect(dto.companyName).toBeUndefined();
  });

  // The limits still apply to anything actually typed in.
  it('still rejects a value that is too short to be real', () => {
    expect(
      failedFields(
        plainToInstance(Dto as ClassConstructor<ProfileFields>, {
          ...required,
          ...blank,
          companyName: 'a',
        }),
      ),
    ).toEqual(['companyName']);
  });

  it('still rejects a malformed e-mail', () => {
    expect(
      failedFields(
        plainToInstance(Dto as ClassConstructor<ProfileFields>, {
          ...required,
          ...blank,
          email: 'not-an-email',
        }),
      ),
    ).toEqual(['email']);
  });
});

/**
 * Updates are the other way round: there `''` is the only way to clear a
 * field, and the services map it to `null`. `@IsEmail()` used to reject it,
 * which made a saved e-mail impossible to remove.
 */
describe.each([
  { name: 'AdminUpdateUserDto', Dto: AdminUpdateUserDto },
  { name: 'UpdateProfileDto', Dto: UpdateProfileDto },
])('$name clearing a field', ({ Dto }) => {
  it('accepts an empty e-mail', () => {
    const dto = plainToInstance(Dto as ClassConstructor<ProfileFields>, {
      email: '',
      name: '',
      phone: '',
    });
    expect(failedFields(dto)).toEqual([]);
    expect(dto.email).toBe('');
  });

  it('still rejects a malformed e-mail', () => {
    expect(
      failedFields(
        plainToInstance(Dto as ClassConstructor<ProfileFields>, {
          email: 'nope',
        }),
      ),
    ).toEqual(['email']);
  });
});
