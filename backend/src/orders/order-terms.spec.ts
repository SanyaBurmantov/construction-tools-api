import { deliveryCostFor, orderMinimum, orderTerms } from './order-terms';

describe('order terms', () => {
  const terms = orderTerms({});

  it('are the owner’s numbers by default', () => {
    expect(terms).toEqual({
      minIndividual: 200,
      minCompany: 50,
      freeDeliveryCompanyFrom: 300,
      courier: 20,
      post: 10,
    });
  });

  it('can be moved by env', () => {
    expect(orderTerms({ ORDER_MIN_INDIVIDUAL: '150' }).minIndividual).toBe(150);
    expect(orderTerms({ DELIVERY_COST_COURIER: 'abc' }).courier).toBe(20);
  });

  it('asks 200 of an individual and 50 of an organisation', () => {
    expect(orderMinimum(terms, false)).toBe(200);
    expect(orderMinimum(terms, true)).toBe(50);
  });

  it('delivers free to an organisation from 300', () => {
    expect(deliveryCostFor(terms, 'COURIER', true, 300)).toBe(0);
    expect(deliveryCostFor(terms, 'POST', true, 299.99)).toBe(10);
    expect(deliveryCostFor(terms, 'COURIER', false, 5000)).toBe(20);
    expect(deliveryCostFor(terms, 'PICKUP', false, 0)).toBe(0);
  });
});
