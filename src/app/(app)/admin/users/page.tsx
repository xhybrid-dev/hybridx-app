
'use client';

import { useEffect, useState } from 'react';
import { Users, Crown, Calendar, Mail, User as UserIcon, Filter, CheckCircle, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getAllUsersClient } from '@/services/user-service-client';
import type { User, SubscriptionStatus } from '@/models/types';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const getStatusColor = (status: SubscriptionStatus): string => {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-800 border-green-200';
    case 'trial': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'canceled': return 'bg-red-100 text-red-800 border-red-200';
    case 'expired': return 'bg-gray-100 text-gray-800 border-gray-200';
    case 'incomplete': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'paused': return 'bg-orange-100 text-orange-800 border-orange-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getExperienceColor = (experience: string): string => {
  switch (experience) {
    case 'beginner': return 'bg-green-100 text-green-800 border-green-200';
    case 'intermediate': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'advanced': return 'bg-red-100 text-red-800 border-red-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [experienceFilter, setExperienceFilter] = useState<string>('all');
  const { toast } = useToast();

  const handleDelete = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }
      toast({ title: 'Success', description: 'User deleted successfully.' });
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete user.',
        variant: 'destructive',
      });
    }
  };

  const fetchUsers = async (retryCount = 0) => {
    setLoading(true);
    try {
      console.log('🔄 Starting to fetch users... (attempt', retryCount + 1, ')');
      const fetchedUsers = await getAllUsersClient();
      console.log('✅ Successfully fetched users:', fetchedUsers.length);
      setUsers(fetchedUsers);
      setFilteredUsers(fetchedUsers);
    } catch (error) {
      console.error('❌ Failed to fetch users:', error);

      // If it's an auth error and we haven't retried yet, try once more after a delay
      if (retryCount === 0 && error instanceof Error &&
          (error.message.includes('not authenticated') || error.message.includes('log in'))) {
        console.log('🔄 Auth error, retrying in 2 seconds...');
        setTimeout(() => fetchUsers(1), 2000);
        return; // Don't set loading to false yet
      }

      toast({
        title: 'Error',
        description: `Failed to load users: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Add a small delay to ensure auth is ready
    const timer = setTimeout(() => {
      fetchUsers();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let filtered = [...users];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(user =>
        (user.email || '').toLowerCase().includes(query) ||
        (user.firstName || '').toLowerCase().includes(query) ||
        (user.lastName || '').toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(user => user.subscriptionStatus === statusFilter);
    }

    // Apply experience filter
    if (experienceFilter !== 'all') {
      filtered = filtered.filter(user => user.experience === experienceFilter);
    }

    setFilteredUsers(filtered);
  }, [users, searchQuery, statusFilter, experienceFilter]);

  const activeUsers = users.filter(u => u.subscriptionStatus === 'active').length;
  const trialUsers = users.filter(u => u.subscriptionStatus === 'trial').length;
  const expiredUsers = users.filter(u => u.subscriptionStatus === 'expired').length;
  const canceledUsers = users.filter(u => u.subscriptionStatus === 'canceled').length;
  const adminUsers = users.filter(u => u.isAdmin).length;

  // Additional statistics
  const newUsersThisMonth = users.filter(u => {
    if (!u.trialStartDate) return false;
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const trialStartDate = u.trialStartDate instanceof Date ? u.trialStartDate : new Date(u.trialStartDate);
    return trialStartDate > oneMonthAgo;
  }).length;

  const usersWithStripe = users.filter(u => u.stripeCustomerId).length;

  const deleteAction = (user: User) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete{' '}
            <strong>
              {user.firstName || user.lastName
                ? `${user.firstName} ${user.lastName}`.trim()
                : user.email}
            </strong>{' '}
            and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handleDelete(user.id)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const rowActions = (user: User) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 w-9 shrink-0 p-0">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{deleteAction(user)}</DropdownMenuContent>
    </DropdownMenu>
  );

  const displayName = (user: User) =>
    user.firstName || user.lastName
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'No name set';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">User Management</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          View and manage registered users of the application.
        </p>
      </div>

      {/* Statistics Cards — two per row on a phone rather than one tall stack. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium sm:text-sm">Total Users</CardTitle>
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl font-bold">{users.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              +{newUsersThisMonth} this month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium sm:text-sm">Active Subscribers</CardTitle>
            <Crown className="h-4 w-4 shrink-0 text-green-600" />
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl font-bold text-green-600">{activeUsers}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {users.length > 0 ? Math.round((activeUsers / users.length) * 100) : 0}% conversion rate
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium sm:text-sm">Trial Users</CardTitle>
            <Calendar className="h-4 w-4 shrink-0 text-blue-600" />
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl font-bold text-blue-600">{trialUsers}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {expiredUsers} expired trials
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium sm:text-sm">Admin Users</CardTitle>
            <UserIcon className="h-4 w-4 shrink-0 text-purple-600" />
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl font-bold text-purple-600">{adminUsers}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {usersWithStripe} have Stripe IDs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Status Breakdown */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-sm font-medium">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="flex justify-between text-sm">
              <span className="text-green-600">Active:</span>
              <span className="font-medium">{activeUsers}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-blue-600">Trial:</span>
              <span className="font-medium">{trialUsers}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Expired:</span>
              <span className="font-medium">{expiredUsers}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-red-600">Canceled:</span>
              <span className="font-medium">{canceledUsers}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="flex flex-col gap-3 md:flex-row md:gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search users by email or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            {/* Side by side on a phone: two half-width selects read better than
                two more full-width rows below the search box. */}
            <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active ({activeUsers})</SelectItem>
                  <SelectItem value="trial">Trial ({trialUsers})</SelectItem>
                  <SelectItem value="expired">Expired ({expiredUsers})</SelectItem>
                  <SelectItem value="canceled">Canceled ({canceledUsers})</SelectItem>
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
              <Select value={experienceFilter} onValueChange={setExperienceFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Filter by experience" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Experience</SelectItem>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>Registered Users</CardTitle>
          <CardDescription>
            Showing {filteredUsers.length} of {users.length} users
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {/* An eleven-column table cannot be read on a phone at any zoom, so
              below lg each user becomes a card carrying the same fields. */}
          <div className="divide-y border-t lg:hidden">
            {loading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Loading users...</p>
            ) : filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <div key={user.id} className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{displayName(user)}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    {rowActions(user)}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={getStatusColor(user.subscriptionStatus || 'trial')}>
                      {user.subscriptionStatus || 'trial'}
                    </Badge>
                    <Badge variant="outline" className={getExperienceColor(user.experience)}>
                      {user.experience}
                    </Badge>
                    {user.isAdmin && (
                      <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">
                        <Crown className="h-3 w-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                    {user.stripeCustomerId ? (
                      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
                        Stripe connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">
                        No Stripe
                      </Badge>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Goal</dt>
                      <dd className="truncate capitalize">{user.goal}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Frequency</dt>
                      <dd>{user.frequency} days/wk</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Workouts</dt>
                      <dd className="flex items-center gap-1 font-medium">
                        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        {user.completedWorkouts || 0}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Trial start</dt>
                      <dd className="truncate">
                        {user.trialStartDate
                          ? format(new Date(user.trialStartDate), 'dd MMM yy')
                          : 'Unknown'}
                      </dd>
                    </div>
                  </dl>

                  <p className="font-mono text-[11px] text-muted-foreground">
                    ID: {user.id.slice(0, 8)}…
                    {user.subscriptionId && ` · sub ${user.subscriptionId.slice(0, 8)}…`}
                  </p>
                </div>
              ))
            ) : (
              <p className="p-4 text-center text-sm text-muted-foreground">
                No users found matching your filters.
              </p>
            )}
          </div>

          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Goal</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Workouts Done</TableHead>
                  <TableHead>Trial Start</TableHead>
                  <TableHead>Stripe Status</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center">
                      Loading users...
                    </TableCell>
                  </TableRow>
                ) : filteredUsers.length > 0 ? (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                            <Mail className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-medium">{displayName(user)}</div>
                            <div className="text-sm text-muted-foreground">
                              ID: {user.id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getExperienceColor(user.experience)}>
                          {user.experience}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusColor(user.subscriptionStatus || 'trial')}>
                          {user.subscriptionStatus || 'trial'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="capitalize">{user.goal}</span>
                      </TableCell>
                      <TableCell>{user.frequency} days/week</TableCell>
                      <TableCell>
                          <div className="flex items-center gap-2">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                              <span className="font-medium">{user.completedWorkouts || 0}</span>
                          </div>
                      </TableCell>
                      <TableCell>
                        {user.trialStartDate
                          ? format(new Date(user.trialStartDate), 'MMM dd, yyyy')
                          : 'Unknown'
                        }
                      </TableCell>
                      <TableCell>
                        {user.stripeCustomerId ? (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
                              Connected
                            </Badge>
                            {user.subscriptionId && (
                              <span className="text-xs text-muted-foreground">
                                ID: {user.subscriptionId.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">
                            No Stripe
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.isAdmin ? (
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">
                            <Crown className="h-3 w-3 mr-1" />
                            Admin
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">User</span>
                        )}
                      </TableCell>
                      <TableCell>{rowActions(user)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center">
                      No users found matching your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
