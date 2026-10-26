import { personName } from '../personName';

const BEN = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';

describe('personName', () => {
  it('prefers your label, then their published name, then the short key', () => {
    expect(personName({ publicKey: BEN, label: 'Ben', publishedName: 'Benjamin' })).toEqual({ name: 'Ben', source: 'label' });
    expect(personName({ publicKey: BEN, publishedName: 'Benjamin' })).toEqual({ name: 'Benjamin', source: 'profile' });
    expect(personName({ publicKey: BEN, label: '  ', publishedName: '' })).toEqual({ name: 'pubky5fpe1…oen1gy', source: 'key' });
  });
});
