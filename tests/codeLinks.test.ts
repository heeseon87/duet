import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '../shared/canvas.ts'
import { lastSeek, linkAt, partsOfFile, pinSource, refsFor, resolveLink, seekOfVia, sourceOf, targetOf, usesOf } from '../web/src/canvas/codeLinks.ts'

const map: CanvasMap = {
  schema: 1, diagram: 'class', title: 't',
  elements: [
    { id: 'svc', kind: 'group' },
    { id: 'OrderService', parent: 'svc', files: ['src/OrderService.kt'], members: [{ text: '-orderRepository: OrderRepository' }, { text: '+place(id: String): Group' }] },
    { id: 'repo', kind: 'group' },
    { id: 'OrderRepository', parent: 'repo', kind: 'interface', files: ['src/OrderRepository.kt'], members: [{ text: '<<interface>>' }, { text: '+save(o: Order)$' }] },
    { id: 'UserRepository', parent: 'repo', files: ['src/UserRepository.kt'], members: [{ text: '+save(u: User)' }, { text: '+String owner' }, { text: '저장한 사용자 수' }] },
    { id: 'Cart', label: 'ShoppingCart' },
    { id: 'Ledger', label: '장부' },
  ],
  relations: [{ from: 'OrderService', to: 'OrderRepository', via: 'field orderRepository' }],
}
const targets = (r: ReturnType<typeof resolveLink>) => r.links.map(l => `${l.target}:${l.owner}:${l.kind}`)

describe('resolveLink', () => {
  it('links box ids and labels that are names, not packages or Korean labels', () => {
    expect(targets(resolveLink(map, { name: 'ShoppingCart', here: [] }))).toEqual(['Cart:Cart:type'])
    expect(targets(resolveLink(map, { name: 'Cart', here: [] }))).toEqual(['Cart:Cart:type'])
    expect(resolveLink(map, { name: 'repo', here: [] }).links).toEqual([])
    expect(resolveLink(map, { name: '장부', here: [] }).links).toEqual([])
  })

  it('links members to their box: functions, typed fields, Mermaid-style fields; not annotations or prose', () => {
    expect(targets(resolveLink(map, { name: 'place', here: [] }))).toEqual(['OrderService:OrderService:function'])
    expect(targets(resolveLink(map, { name: 'orderRepository', here: [] }))).toEqual(['OrderService:OrderService:field'])
    expect(targets(resolveLink(map, { name: 'owner', here: [] }))).toEqual(['UserRepository:UserRepository:field'])
    expect(resolveLink(map, { name: 'interface', here: [] }).links).toEqual([])
  })

  it('goes through the relation whose via names the receiver', () => {
    const r = resolveLink(map, { name: 'save', receiver: 'orderRepository', here: ['OrderService'] })
    expect(r.sure).toBe(true)
    expect(r.links[0].owner).toBe('OrderRepository')
  })

  it('takes a type the receiver names as a static call', () => {
    const r = resolveLink(map, { name: 'save', receiver: 'UserRepository', here: ['OrderService'] })
    expect(r.sure).toBe(true)
    expect(r.links[0].owner).toBe('UserRepository')
  })

  it('offers every candidate for a receiver the map does not know, related or not', () => {
    const r = resolveLink(map, { name: 'save', receiver: 'userRepository', here: ['OrderService'] })
    expect(r.sure).toBe(false)
    expect(targets(r).sort()).toEqual(['OrderRepository:OrderRepository:function', 'UserRepository:UserRepository:function'])
  })

  it('without a receiver prefers the file\'s own part, then a related one', () => {
    const best = (r: ReturnType<typeof resolveLink>) => r.sure && `${r.links[0].owner}:${r.links[0].kind}`
    expect(best(resolveLink(map, { name: 'save', here: ['UserRepository'] }))).toBe('UserRepository:function')
    expect(best(resolveLink(map, { name: 'save', here: ['OrderService'] }))).toBe('OrderRepository:function')
    expect(best(resolveLink(map, { name: 'orderRepository', receiver: 'this', here: ['OrderService'] }))).toBe('OrderService:field')
  })

  it('is not sure about a name two unrelated parts declare', () => {
    const r = resolveLink(map, { name: 'save', here: [] })
    expect(r.sure).toBe(false)
    expect(r.links).toHaveLength(2)
  })

  it('links participants, and a message\'s call to its receiver; none without a receiver', () => {
    const seq: CanvasMap = {
      schema: 1, diagram: 'sequence', title: 's', relations: [],
      elements: [{ id: 'Client', kind: 'actor' }, { id: 'OrderService' }],
      messages: [
        { id: 'm1', from: 'Client', to: 'OrderService', label: 'place(order)' },
        { id: 'm2', from: 'Client', to: 'OrderService', label: 'place(other)' },
        { id: 'm3', from: 'OrderService', label: 'cancel()' },
        { id: 'm4', from: 'Client', to: 'OrderService', label: '주문 넣기' },
      ],
    }
    expect(targets(resolveLink(seq, { name: 'Client', here: [] }))).toEqual(['Client:Client:type'])
    const place = resolveLink(seq, { name: 'place', here: ['Client'] })
    expect([place.sure, ...targets(place)]).toEqual([true, 'm1:OrderService:function'])
    expect(resolveLink(seq, { name: 'cancel', here: [] }).links).toEqual([])
  })
})

describe('a call through a field the map draws (구독 판정에 멤버십 반영)', () => {
  const membership: CanvasMap = {
    schema: 1, diagram: 'class', title: 'm', relations: [{ from: 'memberrepo', to: 'memberjpa', via: 'field membershipJpaRepo' }],
    elements: [
      { id: 'memberrepo', label: 'MembershipRepo', files: ['MembershipRepo.kt'], members: [{ text: 'findActiveByUserId(userId): Membership?' }, { text: 'findByMembershipGroup(group): List<Membership>' }, { text: 'existsByUserId(userId): Boolean (나간·닫힌 이력 포함)' }] },
      { id: 'memberjpa', kind: 'interface', label: 'MembershipJpaRepo', files: ['MembershipJpaRepo.kt'], members: [{ text: 'findByUserIdAndExitedAtIsNull · findByMembershipGroup' }, { text: 'existsByUserId(userId)' }] },
    ],
  }
  const from = (name: string, receiver?: string) => resolveLink(membership, { name, receiver, here: ['memberrepo'] })

  it('reads each name of a member line joined by ·', () => {
    expect(targets(resolveLink(membership, { name: 'findByUserIdAndExitedAtIsNull', here: [] }))).toEqual(['memberjpa:memberjpa:field'])
  })

  it('goes to the box the receiver\'s field leads to, not the caller\'s method of the same name', () => {
    const r = from('findByMembershipGroup', 'membershipJpaRepo')
    expect([r.sure, r.links[0].owner]).toEqual([true, 'memberjpa'])
    expect(from('existsByUserId', 'membershipJpaRepo').links[0].owner).toBe('memberjpa')
  })

  it('goes there even when the map does not list the name', () => {
    const r = from('countByMembershipGroupAndRoleAndExitedAtIsNull', 'membershipJpaRepo')
    expect([r.sure, ...targets(r)]).toEqual([true, 'memberjpa:memberjpa:function'])
    expect(from('countByMembershipGroupAndRoleAndExitedAtIsNull').links).toEqual([])
  })

  it('still takes the file\'s own method without a receiver', () => {
    expect(from('findByMembershipGroup').links[0].owner).toBe('memberrepo')
  })

  it('finds the declaration in the receiver\'s file whatever kind the map gave it', () => {
    const jpa = [
      'package com.example.membership.domain.infra',
      '',
      'import org.springframework.data.jpa.repository.JpaRepository',
      '',
      'interface MembershipJpaRepo : JpaRepository<Membership, Int> {',
      '\t// findByMembershipGroup includes members who left',
      '\tfun findByUserIdAndExitedAtIsNull(userId: String): Membership?',
      '\tfun findByMembershipGroup(membershipGroup: MembershipGroup): List<Membership>',
      '}',
    ]
    expect(targetOf(jpa, 'MembershipJpaRepo.kt', 'MembershipJpaRepo.kt', { names: ['findByMembershipGroup'], kind: 'field' })).toEqual({ rows: [8, 8], lit: 'findByMembershipGroup' })
  })
})

describe('a relation\'s two ends at the call its label names (멤버십 해지)', () => {
  const memberrepo = { id: 'memberrepo', label: 'MembershipRepo', members: [{ text: 'findByMembershipGroup(group): List<Membership>' }] }
  const cancelSvc = [
    'package com.example.membership.service',
    '',
    'import com.example.membership.domain.MembershipRepo',
    '',
    'class MembershipCancelSvc(',
    '    private val membershipRepo: MembershipRepo,',
    ') {',
    '    fun findByMembershipGroup(group: MembershipGroup) = listOf<Membership>()',
    '',
    '    fun cancel(hostUserId: String, membershipGroupId: Int) {',
    '        val memberships = membershipRepo.findByMembershipGroup(membershipGroup)',
    '    }',
    '}',
  ]
  const from = (label: string, via = 'field membershipRepo') => seekOfVia(via, memberrepo, usesOf(label, memberrepo).map(u => u.name))

  it('reads the names the label calls, in its order, and the members the box lists', () => {
    expect(usesOf('tx { findActiveByUserId(host) · findByMembershipGroup }', memberrepo)).toEqual([
      { name: 'findActiveByUserId', kind: 'function' }, { name: 'findByMembershipGroup', kind: 'function' },
    ])
    expect(usesOf('findById', memberrepo)).toEqual([{ name: 'findById', kind: 'function' }])
    expect(usesOf('SELECT 본인 행 + 같은 그룹 HOST (firstOrNull)', memberrepo)).toEqual([])
    expect(usesOf('문서', memberrepo)).toEqual([])
    expect(usesOf(undefined, memberrepo)).toEqual([])
  })

  it('opens the from end where it calls through the via\'s field, not where it declares the same name', () => {
    expect(from('findByMembershipGroup(group)')).toEqual({ uses: ['findByMembershipGroup'], on: ['membershipRepo', 'memberrepo', 'MembershipRepo'], or: { names: ['membershipRepo'], kind: 'field' } })
    expect(targetOf(cancelSvc, 'MembershipCancelSvc.kt', 'MembershipCancelSvc.kt', from('findByMembershipGroup(group)'))).toEqual({ rows: [11, 11], lit: 'findByMembershipGroup' })
  })

  it('reaches a static call through the to box\'s own name, and a bare call where nothing names a receiver', () => {
    const jdbc = ['class Repo {', '    fun all() = rows.map(SubscribeModel::map)', '    fun one() = query { rs -> MembershipRepo.map(rs) }', '    fun two() = save(x)', '}']
    expect(targetOf(jdbc, 'Repo.kt', 'Repo.kt', from('MembershipRepo.map(rs)', 'return one'))).toEqual({ rows: [3, 3], lit: 'map' })
    expect(targetOf(jdbc, 'Repo.kt', 'Repo.kt', from('save(x)', 'new Repo'))).toEqual({ rows: [4, 4], lit: 'save' })
  })

  it('falls back to the via\'s evidence when the label\'s names are not used, and reports a miss for that', () => {
    const seek = from('purge(group)')
    expect(targetOf(cancelSvc, 'MembershipCancelSvc.kt', 'MembershipCancelSvc.kt', seek)).toEqual({ rows: [6, 6], lit: 'membershipRepo' })
    expect(targetOf(cancelSvc, 'MembershipCancelSvc.kt', 'MembershipCancelSvc.kt', from('purge(group)', 'local gone'))).toEqual({ rows: undefined, lit: 'gone', missed: 'gone' })
    expect(lastSeek(from('purge(group)', 'local gone'))).toEqual({ mention: 'gone' })
  })

  it('without names in the label, keeps the via\'s evidence alone', () => {
    expect(from('멤버십 목록')).toEqual({ names: ['membershipRepo'], kind: 'field' })
  })
})

describe('linkAt', () => {
  const at = (text: string, word: string, o = 0) => linkAt(text, text.indexOf(word) + o)
  it('reads the name under a character and its receiver', () => {
    expect(at('  x?.save(o)', 'save', 3)).toEqual({ name: 'save', receiver: 'x' })
    expect(at('val f = Foo::bar', 'bar')).toEqual({ name: 'bar', receiver: 'Foo' })
    expect(at('a->b();', 'b()')).toEqual({ name: 'b', receiver: 'a' })
    expect(at('orderRepository.save(order)', 'orderRepository', 5)).toEqual({ name: 'orderRepository' })
    expect(at('save(x)', 'save')).toEqual({ name: 'save' })
    expect(at('foo().save', 'save')).toEqual({ name: 'save' })
  })
  it('is nothing off a name', () => {
    expect(at('save(x)', '(')).toBeUndefined()
    expect(at('val n = 12', '12')).toBeUndefined()
  })
})

describe('targetOf', () => {
  const kotlin = [
    'package demo',
    '',
    'import demo.Order',
    '',
    'class OrderRepository(',
    '    private val db: Db,',
    ') {',
    '    val cache = 1',
    '    fun save(o: Order) = db.put(o)',
    '    fun save(o: Order, flush: Boolean) = db.put(o)',
    '}',
  ]
  const kt = 'src/OrderRepository.kt'
  it('finds Kotlin functions, properties and constructor vals, lighting the name', () => {
    expect(targetOf(kotlin, kt, kt, { names: ['save'], kind: 'function' })).toEqual({ rows: [9, 9], lit: 'save' })
    expect(targetOf(kotlin, kt, kt, { names: ['cache'], kind: 'field' })).toEqual({ rows: [8, 8], lit: 'cache' })
    expect(targetOf(kotlin, kt, kt, { names: ['db'], kind: 'field' })).toEqual({ rows: [6, 6], lit: 'db' })
    expect(targetOf(kotlin, kt, kt, { names: ['OrderRepository'], kind: 'type' })).toEqual({ rows: [5, 5], lit: 'OrderRepository' })
  })
  it('prefers the overload inside the reference\'s lines', () => {
    expect(targetOf(kotlin, kt, `${kt}:10-11`, { names: ['save'], kind: 'function' }).rows).toEqual([10, 10])
  })
  it('reads a Java method and a TS class', () => {
    const java = ['package demo;', '', 'public class Repo {', '    public void save(Order o) {', '    }', '}']
    expect(targetOf(java, 'Repo.java', 'Repo.java', { names: ['save'], kind: 'function' }).rows).toEqual([4, 4])
    const ts = ['import { x } from "y"', '', 'export class Cart {', '  total = 0', '}']
    expect(targetOf(ts, 'cart.ts', 'cart.ts', { names: ['Cart'], kind: 'type' }).rows).toEqual([3, 3])
  })
  it('gives way to the span when soft, not when looking for a name', () => {
    expect(targetOf(kotlin, kt, `${kt}:8-9`, { names: ['OrderRepository'], kind: 'type', soft: true })).toEqual({ rows: [8, 9] })
    expect(targetOf(kotlin, kt, `${kt}:8-9`, { names: ['OrderRepository'], kind: 'type' }).rows).toEqual([5, 5])
    expect(targetOf(kotlin, kt, kt, { names: ['OrderRepository'], kind: 'type', soft: true })).toEqual({ rows: [5, 5] })
  })
  it('falls back to the first mention past the imports, then says what it missed', () => {
    const go = ['package main', 'import save', '', 'func save() {}']
    expect(targetOf(go, 'main.go', 'main.go', { names: ['save'], kind: 'function' }).rows).toEqual([4, 4])
    expect(targetOf(kotlin, kt, `${kt}:2-3`, { names: ['remove'], kind: 'function' })).toEqual({ rows: [2, 3], lit: 'remove', missed: 'remove' })
    expect(targetOf(kotlin, kt, kt, { names: ['remove'], kind: 'function' })).toEqual({ rows: undefined, lit: 'remove', missed: 'remove' })
    expect(targetOf(kotlin, kt, kt, { names: ['Nothing'], kind: 'type', soft: true })).toEqual({ rows: undefined })
  })
  it('finds a mention past the imports', () => {
    expect(targetOf(kotlin, kt, kt, { mention: 'Order' })).toEqual({ rows: [9, 9], lit: 'Order' })
    expect(targetOf(kotlin, kt, kt, { mention: 'Missing' })).toEqual({ rows: undefined, lit: 'Missing', missed: 'Missing' })
  })
  it('opens a reference without a seek on its lines', () => {
    expect(targetOf(kotlin, kt, `${kt}:3-4`)).toEqual({ rows: [3, 4] })
    expect(targetOf(kotlin, kt, kt)).toEqual({ rows: undefined })
  })
})

describe('seekOfVia', () => {
  const to = { id: 'OrderRepository' }
  it('finds a field or constructor parameter by its declaration, anything else by its first use', () => {
    expect(seekOfVia('field orderRepository', to)).toEqual({ names: ['orderRepository'], kind: 'field' })
    expect(seekOfVia('constructor repo', to)).toEqual({ names: ['repo'], kind: 'field' })
    for (const word of ['param', 'local', 'return', 'new', 'throws', 'extends', 'implements']) expect(seekOfVia(`${word} AuditEntity`, to)).toEqual({ mention: 'AuditEntity' })
    expect(seekOfVia('call repo.save', to)).toEqual({ mention: 'save' })
  })
  it('without a via, looks for the other end\'s name', () => {
    expect(seekOfVia(undefined, to)).toEqual({ mention: 'OrderRepository' })
    expect(seekOfVia('field', to)).toEqual({ mention: 'OrderRepository' })
  })
})

describe('refsFor', () => {
  const m: CanvasMap = { ...map, elements: [...map.elements, { id: 'Repo', files: ['src/Mapper.kt', 'src/Repo.kt:3-9'] }] }
  it('puts the file named like a type first when following a link to it, else keeps the map\'s order', () => {
    expect(refsFor(m, 'Repo', { names: ['Repo'], kind: 'type' })).toEqual(['src/Repo.kt:3-9', 'src/Mapper.kt'])
    expect(refsFor(m, 'Repo', { names: ['Repo'], kind: 'type', soft: true })).toEqual(['src/Mapper.kt', 'src/Repo.kt:3-9'])
    expect(refsFor(m, 'Repo', { names: ['save'], kind: 'function' })).toEqual(['src/Mapper.kt', 'src/Repo.kt:3-9'])
  })
  it('lists a package\'s files and a relation\'s two ends', () => {
    expect(refsFor(m, 'repo')).toEqual(['src/OrderRepository.kt', 'src/UserRepository.kt'])
    expect(refsFor(m, 'OrderService->OrderRepository:association')).toEqual(['src/OrderService.kt', 'src/OrderRepository.kt'])
  })
})

describe('where a file is read', () => {
  it('finds the parts whose own files hold a file', () => {
    expect(partsOfFile(map, { root: '/ws', path: 'src/OrderService.kt' }, '/ws')).toEqual(['OrderService'])
    expect(partsOfFile(map, { root: '/other', path: 'src/OrderService.kt' }, '/ws')).toEqual([])
  })
  const review = { root: '/code', diff: { newRef: 'abc1234' } as never, bound: { map: 'a' }, editing: false }
  it('reads a pinned file at the review\'s version only while the review shows that map\'s code in that root', () => {
    expect(pinSource({ root: '/code', path: 'x.kt' }, 'a', review)).toEqual({ root: '/code', path: 'x.kt', ref: 'abc1234', marks: true })
    expect(pinSource({ root: '/code', path: 'x.kt' }, 'b', review)).toEqual({ root: '/code', path: 'x.kt', ref: 'WORKTREE', marks: false })
    expect(pinSource({ root: '/code', path: 'x.kt' }, 'a', { ...review, editing: true }).ref).toBe('WORKTREE')
  })
  it('keeps a pin taken on a map of another repository readable from its own root', () => {
    expect(pinSource({ root: '/elsewhere', path: 'src/A.kt' }, 'a', review)).toEqual({ root: '/elsewhere', path: 'src/A.kt', ref: 'WORKTREE', marks: false })
  })
  it('reads a map\'s file from the review\'s tree, the workspace or the map\'s own repository', () => {
    expect(sourceOf('/code/src/A.kt', '/ws', 'a', review, '/repo')).toEqual({ root: '/code', path: 'src/A.kt', ref: 'abc1234', marks: true })
    expect(sourceOf('/ws/src/A.kt', '/ws', 'a', review, '/repo')).toEqual({ root: '/ws', path: 'src/A.kt', ref: 'WORKTREE', marks: false })
    expect(sourceOf('/repo/src/A.kt', '/ws', 'a', review, '/repo')).toEqual({ root: '/repo', path: 'src/A.kt', ref: 'WORKTREE', marks: false })
    expect(sourceOf('/nowhere/A.kt', '/ws', 'a', review, '/repo')).toBeUndefined()
  })
})
