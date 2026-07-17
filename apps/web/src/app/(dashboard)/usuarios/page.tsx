'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { authApi, User } from '@/lib/api';
import { FILIAIS } from '@/lib/utils';

const MODULOS_DISPONIVEIS = [
  { key: 'comercial', label: 'Comercial' },
  { key: 'pcp', label: 'PCP' },
];

export default function UsuariosPage() {
  const router = useRouter();
  const { token, isAdmin } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'gerente',
    branchCodes: [] as number[],
    moduleAccess: [] as string[],
    sellerCode: '',
    isActive: true,
  });

  // Modal Redefinir Senha
  const [showSenhaModal, setShowSenhaModal] = useState(false);
  const [usuarioSenha, setUsuarioSenha] = useState<User | null>(null);
  const [novaSenha, setNovaSenha] = useState('');

  // Verificar acesso admin
  useEffect(() => {
    if (!isAdmin) {
      router.push('/');
    }
  }, [isAdmin, router]);

  const carregarUsuarios = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      const { users } = await authApi.getUsers(token);
      setUsers(users);
    } catch (error) {
      showToast('Erro ao carregar usuarios', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    carregarUsuarios();
  }, [carregarUsuarios]);

  // Abrir modal para novo usuário
  function handleNovoUsuario() {
    setEditingUser(null);
    setForm({
      email: '',
      password: '',
      name: '',
      role: 'gerente',
      branchCodes: [],
      moduleAccess: [],
      sellerCode: '',
      isActive: true,
    });
    setShowModal(true);
  }

  // Abrir modal para editar
  function handleEditarUsuario(user: User) {
    setEditingUser(user);
    setForm({
      email: user.email,
      password: '',
      name: user.name,
      role: user.role,
      branchCodes: user.branchCodes || [],
      moduleAccess: user.moduleAccess || [],
      sellerCode: user.sellerCode?.toString() || '',
      isActive: user.isActive ?? true,
    });
    setShowModal(true);
  }

  // Salvar usuário
  async function handleSalvar() {
    if (!token) return;

    if (!form.email || !form.name || !form.role) {
      showToast('Preencha todos os campos obrigatorios', 'error');
      return;
    }

    if (!editingUser && !form.password) {
      showToast('Informe uma senha', 'error');
      return;
    }

    try {
      if (editingUser) {
        // Atualizar
        await authApi.updateUser(token, editingUser.id, {
          name: form.name,
          role: form.role,
          branchCodes: form.branchCodes,
          moduleAccess: form.moduleAccess,
          sellerCode: form.sellerCode ? parseInt(form.sellerCode) : undefined,
          isActive: form.isActive,
          password: form.password || undefined,
        });
        showToast('Usuario atualizado!', 'success');
      } else {
        // Criar
        await authApi.createUser(token, {
          email: form.email,
          password: form.password,
          name: form.name,
          role: form.role,
          branchCodes: form.branchCodes,
          moduleAccess: form.moduleAccess,
          sellerCode: form.sellerCode ? parseInt(form.sellerCode) : undefined,
        });
        showToast('Usuario criado!', 'success');
      }

      setShowModal(false);
      carregarUsuarios();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao salvar', 'error');
      console.error(error);
    }
  }

  // Bloquear / desbloquear usuário
  async function handleToggleAtivo(user: User) {
    if (!token) return;

    const acao = user.isActive ? 'bloquear' : 'desbloquear';
    if (!confirm(`Tem certeza que deseja ${acao} o usuario "${user.name}"?`)) return;

    try {
      await authApi.updateUser(token, user.id, { isActive: !user.isActive });
      showToast(user.isActive ? 'Usuario bloqueado!' : 'Usuario desbloqueado!', 'success');
      carregarUsuarios();
    } catch (error) {
      showToast('Erro ao atualizar usuario', 'error');
      console.error(error);
    }
  }

  // Abrir modal de redefinir senha
  function handleAbrirRedefinirSenha(user: User) {
    setUsuarioSenha(user);
    setNovaSenha('');
    setShowSenhaModal(true);
  }

  // Confirmar redefinição de senha
  async function handleRedefinirSenha() {
    if (!token || !usuarioSenha) return;

    if (!novaSenha || novaSenha.length < 6) {
      showToast('A senha precisa ter pelo menos 6 caracteres', 'error');
      return;
    }

    try {
      await authApi.updateUser(token, usuarioSenha.id, { password: novaSenha });
      showToast(`Senha de ${usuarioSenha.name} redefinida!`, 'success');
      setShowSenhaModal(false);
      setUsuarioSenha(null);
      setNovaSenha('');
    } catch (error) {
      showToast('Erro ao redefinir senha', 'error');
      console.error(error);
    }
  }

  // Deletar usuário
  async function handleDeletar(id: number) {
    if (!token || !confirm('Excluir este usuario?')) return;

    try {
      await authApi.deleteUser(token, id);
      showToast('Usuario excluido!', 'success');
      carregarUsuarios();
    } catch (error) {
      showToast('Erro ao excluir', 'error');
      console.error(error);
    }
  }

  // Toggle seleção de filial
  function toggleBranch(code: number) {
    setForm(prev => ({
      ...prev,
      branchCodes: prev.branchCodes.includes(code)
        ? prev.branchCodes.filter(c => c !== code)
        : [...prev.branchCodes, code],
    }));
  }

  // Toggle seleção de modulo
  function toggleModule(key: string) {
    setForm(prev => ({
      ...prev,
      moduleAccess: prev.moduleAccess.includes(key)
        ? prev.moduleAccess.filter(m => m !== key)
        : [...prev.moduleAccess, key],
    }));
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestao de Usuarios</h1>
          <p className="text-gray-500 text-sm mt-1">
            Gerencie os acessos ao sistema
          </p>
        </div>

        <Button onClick={handleNovoUsuario}>
          + Novo Usuario
        </Button>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle>Usuarios Cadastrados</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="py-10 text-center text-gray-500">Carregando...</div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center text-gray-500">
            Nenhum usuario cadastrado
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>Nome</TableCell>
                <TableCell isHeader>Email</TableCell>
                <TableCell isHeader>Perfil</TableCell>
                <TableCell isHeader>Lojas</TableCell>
                <TableCell isHeader>Modulos</TableCell>
                <TableCell isHeader align="center">Status</TableCell>
                <TableCell isHeader align="center">Acoes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map(user => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === 'admin' ? 'info' : 'default'}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.role === 'admin' ? (
                      <span className="text-gray-500 italic">Todas</span>
                    ) : user.branchCodes?.length ? (
                      <span className="text-sm">
                        {user.branchCodes.map(c => FILIAIS[c] || c).join(', ')}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.role === 'admin' ? (
                      <span className="text-gray-500 italic">Todos</span>
                    ) : user.moduleAccess?.length ? (
                      <span className="text-sm">
                        {user.moduleAccess
                          .map((m) => MODULOS_DISPONIVEIS.find((d) => d.key === m)?.label || m)
                          .join(', ')}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Badge variant={user.isActive ? 'success' : 'danger'}>
                      {user.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell align="center">
                    <div className="flex justify-center gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditarUsuario(user)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAbrirRedefinirSenha(user)}
                      >
                        Redefinir Senha
                      </Button>
                      <Button
                        variant={user.isActive ? 'danger' : 'secondary'}
                        size="sm"
                        onClick={() => handleToggleAtivo(user)}
                      >
                        {user.isActive ? 'Bloquear' : 'Desbloquear'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeletar(user.id)}
                      >
                        Excluir
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingUser ? 'Editar Usuario' : 'Novo Usuario'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nome"
              value={form.name}
              onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Nome completo"
              required
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
              placeholder="email@exemplo.com"
              required
              disabled={!!editingUser}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={editingUser ? 'Nova Senha (deixe vazio para manter)' : 'Senha'}
              type="password"
              value={form.password}
              onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
              placeholder="••••••••"
              required={!editingUser}
            />
            <Select
              label="Perfil"
              value={form.role}
              onChange={(e) => setForm(prev => ({ ...prev, role: e.target.value }))}
              options={[
                { value: 'admin', label: 'Administrador' },
                { value: 'gerente', label: 'Gerente' },
              ]}
            />
          </div>

          {form.role !== 'admin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lojas Permitidas
              </label>
              <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {Object.entries(FILIAIS).map(([code, name]) => (
                  <label
                    key={code}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={form.branchCodes.includes(parseInt(code))}
                      onChange={() => toggleBranch(parseInt(code))}
                      className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                    />
                    <span className="text-sm">{name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {form.role !== 'admin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Modulos Permitidos
              </label>
              <div className="grid grid-cols-2 gap-2 border border-gray-200 rounded-lg p-3">
                {MODULOS_DISPONIVEIS.map((modulo) => (
                  <label
                    key={modulo.key}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={form.moduleAccess.includes(modulo.key)}
                      onChange={() => toggleModule(modulo.key)}
                      className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                    />
                    <span className="text-sm">{modulo.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Input
            label="Codigo Vendedor (opcional)"
            type="number"
            value={form.sellerCode}
            onChange={(e) => setForm(prev => ({ ...prev, sellerCode: e.target.value }))}
            placeholder="Ex: 123"
          />

          {editingUser && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive}
                onChange={(e) => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
                className="w-4 h-4 text-[var(--bbtk-red)] rounded"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">
                Usuario ativo
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="ghost" onClick={() => setShowModal(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar}>
            {editingUser ? 'Atualizar' : 'Criar Usuario'}
          </Button>
        </div>
      </Modal>

      {/* Modal Redefinir Senha */}
      <Modal
        isOpen={showSenhaModal}
        onClose={() => setShowSenhaModal(false)}
        title="Redefinir Senha"
        size="sm"
      >
        {usuarioSenha && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Definir nova senha para <span className="font-medium">{usuarioSenha.name}</span>{' '}
              ({usuarioSenha.email})
            </p>
            <Input
              label="Nova Senha"
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="Minimo 6 caracteres"
              autoFocus
            />
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="ghost" onClick={() => setShowSenhaModal(false)}>
            Cancelar
          </Button>
          <Button onClick={handleRedefinirSenha}>
            Redefinir Senha
          </Button>
        </div>
      </Modal>
    </div>
  );
}
