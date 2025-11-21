'use server';

import { createClient } from '@/lib/supabase/server'; // Needed for user auth
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from '@/app/actions/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod'; // Keep for parsing form data outside of specific schemas
import {
  MenuService,
  IngredientSchema, CreateIngredientInput, UpdateIngredientInput, RecordIngredientPriceInput,
  RecipeSchema, CreateRecipeInput, UpdateRecipeInput,
  DishSchema, CreateDishInput, UpdateDishInput,
} from '@/services/menu';

export async function listMenuIngredients() {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view menu ingredients' };
    }
    const { data } = await MenuService.listIngredients();
    return { data };
  } catch (error: any) {
    console.error('listMenuIngredients unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function getMenuIngredientPrices(ingredientId: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view ingredient prices' };
    }
    const { data } = await MenuService.getIngredientPrices(ingredientId);
    return { data };
  } catch (error: any) {
    console.error('getMenuIngredientPrices unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function createMenuIngredient(input: CreateIngredientInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const payload = IngredientSchema.parse(input);
    const ingredient = await MenuService.createIngredient(payload);

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'menu_ingredient',
      resource_id: ingredient.id,
      operation_status: 'success',
      additional_info: {
        name: ingredient.name,
        pack_cost: payload.pack_cost,
      },
    });

    revalidatePath('/menu-management/ingredients');
    return { success: true, data: ingredient };
  } catch (error: any) {
    console.error('createMenuIngredient unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function updateMenuIngredient(id: string, input: UpdateIngredientInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const payload = IngredientSchema.parse(input);
    const ingredient = await MenuService.updateIngredient(id, payload);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_ingredient',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        name: ingredient.name,
        updates: payload,
      },
    });

    revalidatePath('/menu-management/ingredients');
    return { success: true, data: ingredient };
  } catch (error: any) {
    console.error('updateMenuIngredient unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function recordMenuIngredientPrice(input: RecordIngredientPriceInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const payload = MenuService.recordIngredientPrice(input);

    revalidatePath(`/menu-management/ingredients/${input.ingredient_id}`);
    return { success: true };
  } catch (error: any) {
    console.error('recordMenuIngredientPrice unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function deleteMenuIngredient(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    await MenuService.deleteIngredient(id);

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'menu_ingredient',
      resource_id: id,
      operation_status: 'success',
    });

    revalidatePath('/menu-management/ingredients');
    return { success: true };
  } catch (error: any) {
    console.error('deleteMenuIngredient unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function listMenuRecipes(options?: { includeIngredients?: boolean; includeAssignments?: boolean; }) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view menu recipes' };
    }
    const { data } = await MenuService.listRecipes(options);
    return { data };
  } catch (error: any) {
    console.error('listMenuRecipes unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function getMenuRecipeDetail(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view menu recipes' };
    }
    const { recipe, ingredients, usage } = await MenuService.getRecipeDetail(id);
    return { data: { recipe, ingredients, usage } };
  } catch (error: any) {
    console.error('getMenuRecipeDetail unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function createMenuRecipe(input: CreateRecipeInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu recipes' };
    }

    const payload = RecipeSchema.parse(input);
    const recipe = await MenuService.createRecipe(payload);

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'menu_recipe',
      resource_id: recipe.id,
      operation_status: 'success',
      additional_info: {
        name: recipe.name,
      },
    });

    revalidatePath('/menu-management/recipes');
    return { success: true, data: recipe };
  } catch (error: any) {
    console.error('createMenuRecipe unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function updateMenuRecipe(id: string, input: UpdateRecipeInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu recipes' };
    }

    const payload = RecipeSchema.parse(input);
    const recipe = await MenuService.updateRecipe(id, payload);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_recipe',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        name: recipe.name,
      },
    });

    revalidatePath('/menu-management/recipes');
    revalidatePath(`/menu-management/recipes/${id}`);
    return { success: true, data: recipe };
  } catch (error: any) {
    console.error('updateMenuRecipe unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function deleteMenuRecipe(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu recipes' };
    }

    await MenuService.deleteRecipe(id);

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'menu_recipe',
      resource_id: id,
      operation_status: 'success',
    });

    revalidatePath('/menu-management/recipes');
    return { success: true };
  } catch (error: any) {
    console.error('deleteMenuRecipe unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function listMenuDishes(menuCode?: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view menu dishes' };
    }
    const { data, target_gp_pct } = await MenuService.listDishes(menuCode);
    return { data, target_gp_pct };
  } catch (error: any) {
    console.error('listMenuDishes unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function getMenuDishDetail(dishId: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view menu dishes' };
    }
    const { dish, ingredients, recipes, assignments } = await MenuService.getDishDetail(dishId);
    return { data: { dish, ingredients, recipes, assignments } };
  } catch (error: any) {
    console.error('getMenuDishDetail unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function createMenuDish(input: CreateDishInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu dishes' };
    }

    const payload = DishSchema.parse(input);
    const dish = await MenuService.createDish(payload);

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'menu_dish',
      resource_id: dish.id,
      operation_status: 'success',
      additional_info: {
        name: dish.name,
        selling_price: dish.selling_price,
      },
    });

    revalidatePath('/menu-management/dishes');
    revalidatePath('/menu-management');
    return { success: true, data: dish };
  } catch (error: any) {
    console.error('createMenuDish unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function updateMenuDish(id: string, input: UpdateDishInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu dishes' };
    }

    const payload = DishSchema.parse(input);
    const dish = await MenuService.updateDish(id, payload);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        name: dish.name,
        selling_price: dish.selling_price,
      },
    });

    revalidatePath('/menu-management/dishes');
    revalidatePath(`/menu-management/dishes/${id}`);
    revalidatePath('/menu-management');
    return { success: true, data: dish };
  } catch (error: any) {
    console.error('updateMenuDish unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function deleteMenuDish(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu dishes' };
    }

    await MenuService.deleteDish(id);

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
    });

    revalidatePath('/menu-management/dishes');
    revalidatePath('/menu-management');
    return { success: true };
  } catch (error: any) {
    console.error('deleteMenuDish unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function listMenusWithCategories() {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view menus' };
    }
    const { data } = await MenuService.listMenusWithCategories();
    return { data };
  } catch (error: any) {
    console.error('listMenusWithCategories unexpected error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}